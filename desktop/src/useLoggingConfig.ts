import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { presetLevels } from "./debug-presets";
import { isoIn, isExpired } from "./traceTime";
import type {
  CategoryLevels,
  EntityDto,
  LoggingConfigDto,
  LoggingDiffDto,
  SaveOutcomeDto,
} from "./types";

/** An editable DebugLevel row. `id===null` = locally added, not yet saved. */
export type LevelRow = {
  _key: string;
  id: string | null;
  developerName: string;
  levels: CategoryLevels;
};

/** An editable TraceFlag row. `debugLevelKey` references a `LevelRow._key`. */
export type FlagRow = {
  _key: string;
  id: string | null;
  logType: string;
  tracedEntityId: string;
  tracedEntityName: string;
  tracedEntityKind: string;
  debugLevelKey: string;
  startDate: string | null;
  expirationDate: string | null;
  creatorName: string;
};

function levelChanged(a: CategoryLevels, b: CategoryLevels): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/**
 * Loads the org's trace flags / debug levels / entities for the Configure
 * Logging dialog, holds editable local rows, and commits a computed diff on
 * save (`added`/`modified`/`removed` derived from the original snapshot).
 * Re-fetches when `org` changes.
 */
export function useLoggingConfig(org: string | null) {
  const [entities, setEntities] = useState<EntityDto[]>([]);
  const [levels, setLevels] = useState<LevelRow[]>([]);
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const original = useRef<{ levels: Map<string, LevelRow>; flags: Map<string, FlagRow> }>({
    levels: new Map(),
    flags: new Map(),
  });
  const counter = useRef(0);
  const nextKey = (p: string) => `${p}-${counter.current++}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await invoke<LoggingConfigDto>("load_logging_config");
      const lv: LevelRow[] = cfg.debugLevels.map((d) => ({
        _key: d.id,
        id: d.id,
        developerName: d.developerName,
        levels: d.levels,
      }));
      const fl: FlagRow[] = cfg.traceFlags.map((t) => ({
        _key: t.id,
        id: t.id,
        logType: t.logType,
        tracedEntityId: t.tracedEntityId,
        tracedEntityName: t.tracedEntityName,
        tracedEntityKind: t.tracedEntityKind,
        debugLevelKey: t.debugLevelId,
        startDate: t.startDate,
        expirationDate: t.expirationDate,
        creatorName: t.creatorName,
      }));
      setEntities(cfg.entities);
      setLevels(lv);
      setFlags(fl);
      original.current = {
        levels: new Map(lv.map((r) => [r._key, r])),
        flags: new Map(fl.map((r) => [r._key, r])),
      };
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, org]);

  // ---- mutators ----
  const addLevel = useCallback(() => {
    const key = nextKey("dl");
    setLevels((rows) => [
      ...rows,
      { _key: key, id: null, developerName: "NEW_LEVEL", levels: presetLevels("None") },
    ]);
  }, []);
  const updateLevel = useCallback((key: string, patch: Partial<LevelRow>) => {
    setLevels((rows) => rows.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  }, []);
  const removeLevel = useCallback((key: string) => {
    setLevels((rows) => rows.filter((r) => r._key !== key));
  }, []);

  const addFlag = useCallback(() => {
    const key = nextKey("tf");
    setFlags((rows) => [
      ...rows,
      {
        _key: key,
        id: null,
        logType: "USER_DEBUG",
        tracedEntityId: "",
        tracedEntityName: "",
        tracedEntityKind: "User",
        debugLevelKey: "",
        startDate: null,
        expirationDate: isoIn(24),
        creatorName: "",
      },
    ]);
  }, []);
  const updateFlag = useCallback((key: string, patch: Partial<FlagRow>) => {
    setFlags((rows) => rows.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  }, []);
  const removeFlag = useCallback((key: string) => {
    setFlags((rows) => rows.filter((r) => r._key !== key));
  }, []);
  /** Extend every expired flag to 24h from now (matches the reference's bulk action). */
  const refreshExpired = useCallback(() => {
    setFlags((rows) =>
      rows.map((r) => (isExpired(r.expirationDate) ? { ...r, expirationDate: isoIn(24) } : r)),
    );
  }, []);
  /** Drop every expired flag locally (committed on Save). */
  const removeExpired = useCallback(() => {
    setFlags((rows) => rows.filter((r) => !isExpired(r.expirationDate)));
  }, []);

  // ---- diff ----
  const buildDiff = useCallback((): LoggingDiffDto => {
    const origLevels = original.current.levels;
    const origFlags = original.current.flags;
    const levelByKey = new Map(levels.map((r) => [r._key, r]));

    const diff: LoggingDiffDto = {
      debugLevelsAdded: [],
      debugLevelsModified: [],
      debugLevelsRemoved: [],
      traceFlagsAdded: [],
      traceFlagsModified: [],
      traceFlagsRemoved: [],
    };

    for (const r of levels) {
      if (r.id === null) {
        diff.debugLevelsAdded.push({
          localKey: r._key,
          developerName: r.developerName,
          levels: r.levels,
        });
      } else {
        const o = origLevels.get(r._key);
        if (o && levelChanged(r.levels, o.levels)) {
          diff.debugLevelsModified.push({ id: r.id, levels: r.levels });
        }
      }
    }
    for (const [key, o] of origLevels) {
      if (o.id && !levelByKey.has(key)) diff.debugLevelsRemoved.push(o.id);
    }

    // Reference a level by its real id when saved, else by its localKey.
    const refOf = (levelKey: string): string => {
      const lr = levelByKey.get(levelKey);
      return lr?.id ?? lr?._key ?? levelKey;
    };
    const flagByKey = new Map(flags.map((r) => [r._key, r]));
    for (const r of flags) {
      if (r.id === null) {
        diff.traceFlagsAdded.push({
          logType: r.logType,
          tracedEntityId: r.tracedEntityId,
          debugLevelRef: refOf(r.debugLevelKey),
          startDate: r.startDate,
          expirationDate: r.expirationDate,
        });
      } else {
        const o = origFlags.get(r._key);
        const changed =
          !o ||
          o.debugLevelKey !== r.debugLevelKey ||
          o.startDate !== r.startDate ||
          o.expirationDate !== r.expirationDate;
        if (changed) {
          diff.traceFlagsModified.push({
            id: r.id,
            debugLevelId: levelByKey.get(r.debugLevelKey)?.id ?? r.debugLevelKey,
            startDate: r.startDate,
            expirationDate: r.expirationDate,
          });
        }
      }
    }
    for (const [key, o] of origFlags) {
      if (o.id && !flagByKey.has(key)) diff.traceFlagsRemoved.push(o.id);
    }

    return diff;
  }, [levels, flags]);

  const dirty = useCallback((): boolean => {
    const d = buildDiff();
    return (
      d.debugLevelsAdded.length > 0 ||
      d.debugLevelsModified.length > 0 ||
      d.debugLevelsRemoved.length > 0 ||
      d.traceFlagsAdded.length > 0 ||
      d.traceFlagsModified.length > 0 ||
      d.traceFlagsRemoved.length > 0
    );
  }, [buildDiff]);

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const diff = buildDiff();
      const out = await invoke<SaveOutcomeDto>("save_logging_config", { diff });
      const failures = out.results.filter((r) => !r.ok);
      if (failures.length > 0) {
        const msg = failures.map((f) => `${f.sobject} ${f.op}: ${f.error ?? "failed"}`).join("; ");
        setError(msg);
        toast.error(`Logging config: ${failures.length} failed`);
        await load();
        return false;
      }
      toast.success("Logging configuration saved");
      await load();
      return true;
    } catch (e) {
      const msg = typeof e === "string" ? e : String(e);
      setError(msg);
      toast.error(`Logging config: ${msg}`);
      return false;
    } finally {
      setSaving(false);
    }
  }, [buildDiff, load]);

  return {
    entities,
    levels,
    flags,
    loading,
    saving,
    error,
    addLevel,
    updateLevel,
    removeLevel,
    addFlag,
    updateFlag,
    removeFlag,
    refreshExpired,
    removeExpired,
    dirty,
    save,
    reload: load,
  };
}
