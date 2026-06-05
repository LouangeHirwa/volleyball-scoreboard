"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SetResult {
  a: number;
  b: number;
}

interface MatchState {
  teamA: string;
  teamB: string;
  setsA: number;
  setsB: number;
  pointsA: number;
  pointsB: number;
  currentSet: number;
  history: SetResult[];
  matchOver: boolean;
  serving: "A" | "B";
}

// ---------------------------------------------------------------------------
// Volleyball rules
// ---------------------------------------------------------------------------

const TARGET = (set: number) => (set >= 5 ? 15 : 25);

function setWinner(a: number, b: number, set: number): "A" | "B" | null {
  const t = TARGET(set);
  if (a >= t && a - b >= 2) return "A";
  if (b >= t && b - a >= 2) return "B";
  return null;
}

// ---------------------------------------------------------------------------
// Default state
// ---------------------------------------------------------------------------

const DEFAULT_STATE: MatchState = {
  teamA: "Team A",
  teamB: "Team B",
  setsA: 0,
  setsB: 0,
  pointsA: 0,
  pointsB: 0,
  currentSet: 1,
  history: [],
  matchOver: false,
  serving: "A",
};

// ---------------------------------------------------------------------------
// Push state to Supabase
// ---------------------------------------------------------------------------

async function pushState(state: MatchState) {
  await supabase
    .from("match_state")
    .update({ state, updated_at: new Date().toISOString() })
    .eq("id", 1);
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [matchState, setMatchState] = useState<MatchState>(DEFAULT_STATE);
  const [showAuth, setShowAuth] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const resultCardRef = useRef<HTMLDivElement>(null);

  // ── Auth listener ────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── Load initial state + subscribe to realtime ───────────────────────────
  useEffect(() => {
    supabase
      .from("match_state")
      .select("state")
      .eq("id", 1)
      .single()
      .then(({ data }) => {
        if (data?.state) setMatchState(data.state as MatchState);
      });

    const channel = supabase
      .channel("match_state_changes")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "match_state", filter: "id=eq.1" },
        (payload) => {
          setMatchState(payload.new.state as MatchState);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Show result modal when match ends
  useEffect(() => {
    if (matchState.matchOver) setShowResult(true);
  }, [matchState.matchOver]);

  // ── Scoring actions (editor only) ────────────────────────────────────────
  const addPoint = useCallback((team: "A" | "B") => {
    setMatchState((prev) => {
      if (prev.matchOver) return prev;
      const newA = team === "A" ? prev.pointsA + 1 : prev.pointsA;
      const newB = team === "B" ? prev.pointsB + 1 : prev.pointsB;
      const winner = setWinner(newA, newB, prev.currentSet);

      let next: MatchState;
      if (!winner) {
        next = { ...prev, pointsA: newA, pointsB: newB, serving: team };
      } else {
        const newHistory = [...prev.history, { a: newA, b: newB }];
        const newSetsA = prev.setsA + (winner === "A" ? 1 : 0);
        const newSetsB = prev.setsB + (winner === "B" ? 1 : 0);
        next = {
          ...prev,
          pointsA: 0,
          pointsB: 0,
          setsA: newSetsA,
          setsB: newSetsB,
          currentSet: prev.currentSet + 1,
          history: newHistory,
          matchOver: newSetsA === 3 || newSetsB === 3,
          serving: team,
        };
      }
      pushState(next);
      return next;
    });
  }, []);

  const removePoint = useCallback((team: "A" | "B") => {
    setMatchState((prev) => {
      if (prev.matchOver) return prev;
      const next = {
        ...prev,
        pointsA: team === "A" ? Math.max(0, prev.pointsA - 1) : prev.pointsA,
        pointsB: team === "B" ? Math.max(0, prev.pointsB - 1) : prev.pointsB,
      };
      pushState(next);
      return next;
    });
  }, []);

  const updateName = useCallback((team: "A" | "B", name: string) => {
    setMatchState((prev) => {
      const next = {
        ...prev,
        teamA: team === "A" ? name : prev.teamA,
        teamB: team === "B" ? name : prev.teamB,
      };
      pushState(next);
      return next;
    });
  }, []);

  const resetMatch = useCallback(() => {
    const next: MatchState = {
      ...DEFAULT_STATE,
      teamA: matchState.teamA,
      teamB: matchState.teamB,
    };
    setMatchState(next);
    pushState(next);
    setShowResult(false);
  }, [matchState.teamA, matchState.teamB]);

  // ── Export image ─────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  async function exportImage() {
    if (!resultCardRef.current) return;
    setExporting(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(resultCardRef.current, {
        backgroundColor: "#1e293b",
        scale: 2,
        useCORS: true,
      });
      const link = document.createElement("a");
      link.download = `${matchState.teamA}_vs_${matchState.teamB}_result.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } finally {
      setExporting(false);
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const target = TARGET(matchState.currentSet);
  const matchWinner = matchState.matchOver
    ? matchState.setsA === 3 ? matchState.teamA : matchState.teamB
    : null;
  const isEditor = !!user;

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-start p-4 gap-6">

      {/* Header */}
      <div className="w-full max-w-2xl flex items-center justify-between pt-2">
        <h1 className="text-xl font-bold tracking-wide text-slate-300 uppercase">
          🏐 Volleyball
        </h1>
        <div className="flex items-center gap-3">
          {isEditor && (
            <button
              onClick={resetMatch}
              className="text-sm px-4 py-1.5 rounded-full border border-slate-600 text-slate-400 hover:border-red-500 hover:text-red-400 transition-colors"
            >
              New Match
            </button>
          )}
          {isEditor ? (
            <button
              onClick={() => supabase.auth.signOut()}
              className="text-sm px-4 py-1.5 rounded-full border border-slate-600 text-slate-400 hover:border-slate-400 hover:text-white transition-colors"
            >
              Sign out
            </button>
          ) : (
            <button
              onClick={() => setShowAuth(true)}
              className="text-sm px-4 py-1.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white transition-colors font-medium"
            >
              Editor sign in
            </button>
          )}
        </div>
      </div>

      {/* Viewer badge */}
      {!isEditor && (
        <div className="text-xs text-slate-500 bg-slate-800 px-3 py-1 rounded-full">
          👁 View only — scores update live
        </div>
      )}

      {/* Set indicator */}
      <div className="text-slate-400 text-sm font-medium tracking-widest uppercase">
        {matchState.matchOver
          ? "Match Over"
          : `Set ${matchState.currentSet} · First to ${target}`}
      </div>

      {/* Scoreboard */}
      <div className="w-full max-w-2xl grid grid-cols-2 gap-3">
        {(["A", "B"] as const).map((team) => {
          const name = team === "A" ? matchState.teamA : matchState.teamB;
          const points = team === "A" ? matchState.pointsA : matchState.pointsB;
          const sets = team === "A" ? matchState.setsA : matchState.setsB;
          const isServing = matchState.serving === team && !matchState.matchOver;

          return (
            <TeamPanel
              key={team}
              name={name}
              points={points}
              sets={sets}
              isServing={isServing}
              isEditor={isEditor}
              matchOver={matchState.matchOver}
              onAddPoint={() => addPoint(team)}
              onRemovePoint={() => removePoint(team)}
              onNameChange={(val) => updateName(team, val)}
            />
          );
        })}
      </div>

      {/* Set history */}
      {matchState.history.length > 0 && (
        <div className="w-full max-w-2xl bg-slate-800 rounded-2xl p-4">
          <div className="text-slate-400 text-xs uppercase tracking-widest mb-3">Set History</div>
          <div className="flex flex-col gap-2">
            {matchState.history.map((s, i) => {
              const won = s.a > s.b ? "A" : "B";
              const winnerName = won === "A" ? matchState.teamA : matchState.teamB;
              return (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span className="text-slate-500 w-12">Set {i + 1}</span>
                  <span className={`font-bold tabular-nums ${won === "A" ? "text-emerald-400" : "text-white"}`}>{s.a}</span>
                  <span className="text-slate-600">–</span>
                  <span className={`font-bold tabular-nums ${won === "B" ? "text-emerald-400" : "text-white"}`}>{s.b}</span>
                  <span className="text-slate-500 text-xs ml-1">({winnerName} won)</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!matchState.matchOver && (
        <div className="text-slate-600 text-xs"><span className="text-yellow-400">●</span> = serving</div>
      )}

      {/* Reopen result */}
      {matchState.matchOver && !showResult && (
        <button
          onClick={() => setShowResult(true)}
          className="text-sm px-5 py-2 rounded-full bg-emerald-700 hover:bg-emerald-600 transition-colors font-semibold"
        >
          🏆 View Result
        </button>
      )}

      {/* Auth modal */}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}

      {/* Result modal */}
      {showResult && matchWinner && (
        <ResultModal
          state={matchState}
          matchWinner={matchWinner}
          resultCardRef={resultCardRef}
          exporting={exporting}
          onExport={exportImage}
          onNewMatch={resetMatch}
          onClose={() => setShowResult(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TeamPanel
// ---------------------------------------------------------------------------

function TeamPanel({
  name, points, sets, isServing, isEditor, matchOver,
  onAddPoint, onRemovePoint, onNameChange,
}: {
  name: string;
  points: number;
  sets: number;
  isServing: boolean;
  isEditor: boolean;
  matchOver: boolean;
  onAddPoint: () => void;
  onRemovePoint: () => void;
  onNameChange: (val: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="bg-slate-800 rounded-2xl p-4 flex flex-col items-center gap-3">
      {/* Name */}
      {editing && isEditor ? (
        <input
          autoFocus
          className="w-full text-center text-lg font-bold bg-slate-700 rounded-lg px-3 py-1 outline-none border border-slate-500 focus:border-blue-400"
          defaultValue={name}
          onBlur={(e) => {
            const val = e.target.value.trim() || name;
            onNameChange(val);
            setEditing(false);
          }}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        />
      ) : (
        <button
          onClick={() => isEditor && setEditing(true)}
          className={`text-lg font-bold text-white flex items-center gap-1.5 ${isEditor ? "hover:text-blue-300 transition-colors" : "cursor-default"}`}
        >
          {name}
          {isServing && <span className="text-yellow-400 text-base">●</span>}
          {isEditor && <span className="text-slate-500 text-xs">✎</span>}
        </button>
      )}

      {/* Sets won dots */}
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full border-2 transition-colors ${
              i < sets ? "bg-emerald-400 border-emerald-400" : "border-slate-600"
            }`}
          />
        ))}
      </div>

      {/* Points */}
      <div className="text-8xl font-black tabular-nums leading-none py-2">{points}</div>

      {/* Buttons — only for editors */}
      {isEditor ? (
        <div className="flex gap-3 w-full">
          <button
            onClick={onRemovePoint}
            disabled={matchOver || points === 0}
            className="flex-1 py-3 rounded-xl bg-slate-700 text-2xl font-bold hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            −
          </button>
          <button
            onClick={onAddPoint}
            disabled={matchOver}
            className="flex-[2] py-3 rounded-xl bg-emerald-600 text-2xl font-bold hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors active:scale-95"
          >
            +
          </button>
        </div>
      ) : (
        <div className="h-12" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AuthModal
// ---------------------------------------------------------------------------

function AuthModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-3xl p-6 w-full max-w-sm flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Editor Sign In</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-2xl leading-none">×</button>
        </div>

        <form onSubmit={signIn} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-slate-400">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-slate-700 rounded-xl px-4 py-3 outline-none border border-slate-600 focus:border-blue-400 text-white"
              placeholder="you@example.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-slate-400">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-slate-700 rounded-xl px-4 py-3 outline-none border border-slate-600 focus:border-blue-400 text-white"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="py-3 rounded-xl bg-blue-600 hover:bg-blue-500 font-bold disabled:opacity-50 transition-colors"
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <p className="text-slate-500 text-xs text-center">
          No account? Create one in the Supabase dashboard under Authentication → Users.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResultModal
// ---------------------------------------------------------------------------

function ResultModal({
  state, matchWinner, resultCardRef, exporting, onExport, onNewMatch, onClose,
}: {
  state: MatchState;
  matchWinner: string;
  resultCardRef: React.RefObject<HTMLDivElement | null>;
  exporting: boolean;
  onExport: () => void;
  onNewMatch: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-3xl p-6 w-full max-w-sm flex flex-col gap-5">
        <h2 className="text-center text-2xl font-black text-white">Match Complete!</h2>

        {/* Exportable card */}
        <div ref={resultCardRef} className="bg-slate-800 rounded-2xl p-5 flex flex-col gap-4">
          <div className="text-center text-slate-400 text-xs uppercase tracking-widest">Final Result</div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 text-center">
              <div className="text-sm font-semibold text-slate-300 truncate">{state.teamA}</div>
              <div className={`text-6xl font-black mt-1 ${state.setsA > state.setsB ? "text-emerald-400" : "text-white"}`}>
                {state.setsA}
              </div>
            </div>
            <div className="text-slate-500 text-2xl font-bold">:</div>
            <div className="flex-1 text-center">
              <div className="text-sm font-semibold text-slate-300 truncate">{state.teamB}</div>
              <div className={`text-6xl font-black mt-1 ${state.setsB > state.setsA ? "text-emerald-400" : "text-white"}`}>
                {state.setsB}
              </div>
            </div>
          </div>

          <div className="bg-emerald-600 rounded-xl py-2 px-4 text-center font-bold text-white">
            🏆 {matchWinner} wins!
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="text-slate-500 text-xs uppercase tracking-widest text-center mb-1">Set by Set</div>
            {state.history.map((s, i) => (
              <div key={i} className="flex justify-between items-center text-sm px-2">
                <span className={`font-bold tabular-nums ${s.a > s.b ? "text-emerald-400" : "text-slate-300"}`}>{s.a}</span>
                <span className="text-slate-500 text-xs">Set {i + 1}</span>
                <span className={`font-bold tabular-nums ${s.b > s.a ? "text-emerald-400" : "text-slate-300"}`}>{s.b}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onExport}
            disabled={exporting}
            className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 font-bold text-sm disabled:opacity-50 transition-colors"
          >
            {exporting ? "Exporting…" : "📸 Save Image"}
          </button>
          <button
            onClick={onNewMatch}
            className="flex-1 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 font-bold text-sm transition-colors"
          >
            New Match
          </button>
        </div>

        <button onClick={onClose} className="text-slate-500 text-sm text-center hover:text-slate-300 transition-colors">
          Close
        </button>
      </div>
    </div>
  );
}
