import React, { useState, useMemo, useRef } from 'react';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import './screening-theme.css';

// 1. Import official lightweight AWS SDK client parts
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { fetchAuthSession } from 'aws-amplify/auth';
import outputs from '../amplify_outputs.json';

// Pull dynamic infrastructure naming variables from the local Amplify output file
const FUNCTION_NAME = (outputs as any).custom?.rankerFunctionName;
const REGION = (outputs as any).custom?.awsRegion;

type Candidate = { name: string; jobTitle: string };

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (c === "," && !q) { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export function parseCsv(text: string): Candidate[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = splitLine(lines[0] ?? "").map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  let ni = header.findIndex((h) => h === "name" || h === "fullname" || h === "candidatename" || h === "id");
  let ji = header.findIndex((h) => h.includes("job") || h === "title" || h === "position" || h === "role");
  let rows = lines.slice(1);
  if (ni < 0 || ji < 0) { ni = 0; ji = 1; rows = lines; }
  return rows
    .map(splitLine)
    .map((c) => ({ name: c[ni] ?? "", jobTitle: c[ji] ?? "" }))
    .filter((c) => c.name || c.jobTitle);
}

export function parseRanks(data: unknown, count: number): Map<number, number> {
  const m = new Map<number, number>();
  const obj = data as Record<string, unknown> | null;
  const arr = Array.isArray(data) ? data : (obj?.["scores"] ?? obj?.["rankings"] ?? obj?.["ranks"] ?? obj?.["ranking"]) as unknown;
  if (!Array.isArray(arr)) return m;
  arr.forEach((v, i) => {
    if (typeof v === "number") { if (i < count) m.set(i, v); }
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const idx = Number(o["index"] ?? o["idx"]);
      const r = Number(o["rank"] ?? o["similarity_rank"] ?? o["similarityRank"]);
      if (Number.isFinite(idx) && Number.isFinite(r)) m.set(idx, r);
    }
  });
  return m;
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: Array<Record<string, string>>): string {
  const first = rows[0];
  if (!first) return "";
  const keys = Object.keys(first);

  return [
    keys.join(","),
    ...rows.map((r) => keys.map((k) => csvCell(r[k] ?? "")).join(",")),
  ].join("\r\n");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function deliverFile(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: blob.type });
  const touch = matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return;
    }
  }
  downloadBlob(blob, filename);
}

export default function App() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [drag, setDrag] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [ranks, setRanks] = useState<Map<number, number> | null>(null);
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (list: FileList | null) => {
    if (!list) return;
    const added: Candidate[] = [];
    const names: string[] = [];
    for (const f of Array.from(list)) {
      if (!f.name.toLowerCase().endsWith(".csv")) continue;
      added.push(...parseCsv(await f.text()));
      names.push(f.name);
    }
    setCandidates((p) => [...p, ...added]);
    setFiles((p) => [...p, ...names]);
    setRanks(null);
  };

  const rows = useMemo(() => {
    const s = search.toLowerCase().trim();
    const list = candidates
      .map((c, i) => ({ ...c, i, rank: ranks?.get(i) }))
      .filter((c) => !s || c.name.toLowerCase().includes(s) || c.jobTitle.toLowerCase().includes(s));
    if (ranks) list.sort((a, b) => (b.rank ?? -Infinity) - (a.rank ?? -Infinity));
    return list;
  }, [candidates, search, ranks]);

  const csv = useMemo(() => {
    if (!ranks) return "";
    return toCsv(
      candidates
        .map((c, i) => ({ ...c, rank: ranks.get(i) }))
        .sort((a, b) => (b.rank ?? -Infinity) - (a.rank ?? -Infinity))
        .map((c) => ({
          name: c.name,
          job_title: c.jobTitle,
          similarity_rank: c.rank === undefined ? "" : String(c.rank),
        })),
    );
  }, [candidates, ranks]);

  const downloadCsv = () => {
    if (!csv) return;
    void deliverFile(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      "candidate-similarity-ranks.csv",
    );
  };

  const toggle = (i: number) =>
    setSelected((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const submit = async () => {
    setStatus("sending");
    setError("");
    try {
      if (!FUNCTION_NAME || !REGION) {
        throw new Error("Missing rankerFunctionName / awsRegion in amplify_outputs.json (custom section).");
      }
      const session = await fetchAuthSession();
      const credentials = session.credentials;
      if (!credentials) throw new Error("Your session expired. Please sign in again.");

      const lambdaClient = new LambdaClient({
        region: REGION,
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          sessionToken: credentials.sessionToken,
        },
      });

      const payload = {
        candidates: candidates.map((c) => ({ name: c.name, jobTitle: c.jobTitle })),
        keywords: [keyword.trim()],
        mode: selected.size > 0 ? "rerank" : "initial",
        good_idxs: [...selected].sort((a, b) => a - b),
        alpha: 0.4,
      };

      const response = await lambdaClient.send(new InvokeCommand({
        FunctionName: FUNCTION_NAME,
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(JSON.stringify(payload)),
      }));

      if (!response.Payload) throw new Error("The ranker returned nothing.");
      const text = new TextDecoder().decode(response.Payload);
      let json: any = JSON.parse(text);

      // Handler crashed inside the container (timeout, import error, OOM...)
      if (response.FunctionError || json?.errorMessage) {
        throw new Error(`Ranker error (${response.FunctionError ?? "Handler"}): ${json?.errorMessage ?? text}`);
      }
      // API-Gateway-style responses: { statusCode, body: "<json string>" }
      if (json && typeof json.body === "string") json = JSON.parse(json.body);
      else if (json && json.body && typeof json.body === "object") json = json.body;

      const parsed = parseRanks(json, candidates.length);
      if (!parsed.size) throw new Error(`Couldn't read rankings from: ${text.slice(0, 200)}`);
      setRanks(parsed);
      setStatus("idle");
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Something went wrong reaching the ranker.");
      setStatus("error");
    }
  };

  const clear = () => { setCandidates([]); setSelected(new Set()); setFiles([]); setRanks(null); };
  const canSubmit = candidates.length > 0 && keyword.trim() !== "" && status !== "sending";

  return (
    <Authenticator>
      {({ signOut, user }) => (
        <div className="sd min-h-screen bg-[var(--sd-bg)] text-[var(--sd-fg)]">
          <header className="sd-hero px-8 pb-16 pt-12">
            <div className="mx-auto flex max-w-6xl items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-[var(--sd-primary)]">Welcome back{user?.username ? `, ${user.username}` : ""} 👋</p>
                <h1 className="sd-display mt-2 text-4xl md:text-5xl">Let's find your next great hire.</h1>
                <p className="mt-3 max-w-xl text-[var(--sd-muted-fg)]">
                  Bring in your candidates, tell us what you're looking for, and highlight the people who caught your eye.
                </p>
              </div>
              <button onClick={signOut} className="rounded-full border border-[var(--sd-border)] bg-[var(--sd-card)] px-4 py-2 text-sm font-medium transition hover:text-[var(--sd-danger)]">
                Sign out
              </button>
            </div>
          </header>

          <main className="mx-auto -mt-10 grid max-w-6xl gap-6 px-8 pb-16 lg:grid-cols-[1fr_340px]">
            <section className="space-y-6">
              <div
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={async (e) => { e.preventDefault(); setDrag(false); await handleFiles(e.dataTransfer.files); }}
                className={`sd-shadow cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-all ${drag ? "scale-[1.01] border-[var(--sd-primary)] bg-[var(--sd-accent)]" : "border-[var(--sd-border)] bg-[var(--sd-card)] hover:border-[var(--sd-primary)]"}`}
              >
                <input ref={inputRef} type="file" accept=".csv" multiple hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--sd-accent)] text-2xl">📄</div>
                <p className="font-medium">Drop your candidate CSVs here</p>
                <p className="mt-1 text-sm text-[var(--sd-muted-fg)]">or click to browse · we'll look for name and job title</p>
                {files.length > 0 && (
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {files.map((f, i) => (
                      <span key={i} className="rounded-full bg-[var(--sd-accent)] px-3 py-1 text-xs">{f}</span>
                    ))}
                  </div>
                )}
              </div>

              <div className="sd-shadow overflow-hidden rounded-2xl border border-[var(--sd-border)] bg-[var(--sd-card)]">
                <div className="flex flex-wrap items-center gap-3 border-b border-[var(--sd-border)] p-4">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="🔍  Search by name or job…"
                    className="sd-input flex-1 rounded-full border border-[var(--sd-border)] bg-[var(--sd-bg)] px-4 py-2 text-sm"
                  />
                  <span className="text-sm text-[var(--sd-muted-fg)]">{selected.size} of {candidates.length} promising</span>
                  {candidates.length > 0 && (
                    <button onClick={clear} className="text-sm text-[var(--sd-muted-fg)] hover:text-[var(--sd-danger)]">Start over</button>
                  )}
                </div>
                {candidates.length === 0 ? (
                  <div className="p-12 text-center">
                    <p className="text-3xl">🌱</p>
                    <p className="mt-2 font-medium">No candidates yet</p>
                    <p className="text-sm text-[var(--sd-muted-fg)]">Upload a CSV above to get started.</p>
                  </div>
                ) : (
                  <div className="max-h-[540px] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-[var(--sd-muted)] text-left text-xs uppercase tracking-wide text-[var(--sd-muted-fg)]">
                        <tr>
                          <th className="w-12 px-4 py-3">⭐</th>
                          {ranks && <th className="px-4 py-3">Similarity rank</th>}
                          <th className="px-4 py-3">Name</th>
                          <th className="px-4 py-3">Job title</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--sd-border)]">
                        {rows.map((c) => (
                          <tr
                            key={c.i}
                            onClick={() => toggle(c.i)}
                            className={`cursor-pointer transition-colors hover:bg-[var(--sd-muted)] ${selected.has(c.i) ? "bg-[var(--sd-accent)]" : ""}`}
                          >
                            <td className="px-4 py-3">
                              <input type="checkbox" checked={selected.has(c.i)} onChange={() => toggle(c.i)} onClick={(e) => e.stopPropagation()} className="h-4 w-4 accent-[var(--sd-primary)]" />
                            </td>
                            {ranks && (
                              <td className="px-4 py-3">
                                {c.rank !== undefined ? (
                                  <span className="rounded-full bg-[var(--sd-primary)] px-2.5 py-0.5 text-xs font-semibold text-[var(--sd-primary-fg)]">{c.rank}</span>
                                ) : <span className="text-[var(--sd-muted-fg)]">—</span>}
                              </td>
                            )}
                            <td className="px-4 py-3 font-medium">{c.name}</td>
                            <td className="px-4 py-3 text-[var(--sd-muted-fg)]">{c.jobTitle}</td>
                          </tr>
                        ))}
                        {rows.length === 0 && (
                          <tr><td colSpan={4} className="p-6 text-center text-[var(--sd-muted-fg)]">No one matches that search.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>

            <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
              <div className="sd-shadow rounded-2xl border border-[var(--sd-border)] bg-[var(--sd-card)] p-6">
                <label className="text-sm font-medium">What are you looking for?</label>
                <p className="mt-1 text-xs text-[var(--sd-muted-fg)]">A skill, role, or quality to match candidates against.</p>
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="e.g. Senior Fullstack Developer"
                  className="sd-input mt-3 w-full rounded-full border border-[var(--sd-border)] bg-[var(--sd-bg)] px-4 py-2 text-sm"
                />
                <div className="mt-4 space-y-1 rounded-xl bg-[var(--sd-accent)] p-3 text-xs">
                  <p>🌿 <span className="font-semibold">First pass:</span> leave everyone unticked to get starting ranks.</p>
                  <p>⭐ <span className="font-semibold">Refine:</span> tick promising people, then re-rank to find more like them.</p>
                </div>
                <button
                  onClick={submit}
                  disabled={!canSubmit}
                  className="sd-shadow mt-5 w-full rounded-full bg-[var(--sd-primary)] px-4 py-3 text-sm font-semibold text-[var(--sd-primary-fg)] transition hover:opacity-90 disabled:opacity-40"
                >
                  {status === "sending" ? "Ranking candidates…" : selected.size > 0 ? "Re-rank with my picks" : "Submit screening"}
                </button>
                {status === "error" && <p className="mt-3 text-sm text-[var(--sd-danger)]">Couldn't get rankings: {error}</p>}
                {ranks && status === "idle" && <p className="mt-3 text-sm text-[var(--sd-primary)]">✨ Rankings are in — the list is sorted by similarity.</p>}
                {ranks && csv && (
                  <button
                    onClick={downloadCsv}
                    className="sd-shadow mt-4 w-full rounded-full border border-[var(--sd-border)] bg-[var(--sd-bg)] px-4 py-3 text-sm font-semibold transition hover:bg-[var(--sd-muted)]"
                  >
                    ⬇️ Download candidates &amp; ranks (CSV)
                  </button>
                )}
              </div>
            </aside>
          </main>
        </div>
      )}
    </Authenticator>
  );
}
