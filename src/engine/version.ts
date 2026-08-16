/**
 * Version of the engine's ANALYSIS SEMANTICS, folded into the analysis cache key.
 *
 * The cache key already covers the inputs (file hashes, config, profile versions)
 * and the persisted shape (ANALYSIS_CACHE_SCHEMA_VERSION). What neither covers is
 * a change to what the engine COMPUTES: a bug fix that alters counts, severities,
 * matching, or gating leaves every existing cache entry keyed as if it were still
 * valid, and stale wrong results are served indefinitely.
 *
 * Bump this whenever engine behavior changes in a way that could alter any stored
 * result — even when no type changes shape. Starts at 2 because version 1 is the
 * implied semantics of every entry cached before this constant existed, and the
 * Phase 1 correctness fixes (document decoding, identity-keyed field stats, the
 * collision-proof record key) changed results without changing shape.
 *
 * Version 3: the search index now covers baseline values as well as latest ones,
 * so records stay findable by text that the candidate export wiped.
 *
 * Version 4: QA emits schema_field_added and field_type_change findings, so a
 * cached review no longer reflects the full finding set.
 */
export const ENGINE_SEMANTICS_VERSION = 4;
