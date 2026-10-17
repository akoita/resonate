function vars(projectConfig) {
  return projectConfig.vars || {};
}

function varOrDefault(projectConfig, name, fallback) {
  const value = vars(projectConfig)[name];
  return value === undefined || value === null || value === "" ? fallback : value;
}

function requiredVar(projectConfig, name) {
  const value = vars(projectConfig)[name];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required Dataform compilation variable: ${name}`);
  }
  return value;
}

function identifier(value, name) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid BigQuery identifier for ${name}: ${value}`);
  }
  return value;
}

function quotedTableRef(projectConfig, tableVar, fallback) {
  const project = identifier(requiredVar(projectConfig, "analytics_project"), "analytics_project");
  const dataset = identifier(requiredVar(projectConfig, "analytics_dataset"), "analytics_dataset");
  const table = identifier(varOrDefault(projectConfig, tableVar, fallback), tableVar);
  return `\`${project}.${dataset}.${table}\``;
}

function cleanTableRef(projectConfig) {
  return quotedTableRef(projectConfig, "clean_table", "events_clean");
}

function rawTableRef(projectConfig) {
  return quotedTableRef(projectConfig, "raw_table", "events_raw");
}

function eligibleEventsTableName(projectConfig) {
  return identifier(
    varOrDefault(projectConfig, "discovery_popularity_events_table", "discovery_popularity_eligible_events"),
    "discovery_popularity_events_table",
  );
}

function trackPopularityTableName(projectConfig) {
  return identifier(varOrDefault(projectConfig, "track_popularity_table", "track_popularity"), "track_popularity_table");
}

function artistEngagementTableName(projectConfig) {
  return identifier(varOrDefault(projectConfig, "artist_engagement_table", "artist_engagement"), "artist_engagement_table");
}

function snapshotTableName(projectConfig) {
  return identifier(varOrDefault(projectConfig, "discovery_popularity_snapshot_table", "discovery_popularity_snapshot"), "discovery_popularity_snapshot_table");
}

function minimumAudience(projectConfig) {
  return positiveInteger(varOrDefault(projectConfig, "discovery_min_audience", "3"), "discovery_min_audience");
}

function snapshotMaxAgeMinutes(projectConfig) {
  return positiveInteger(varOrDefault(projectConfig, "discovery_snapshot_max_age_minutes", "120"), "discovery_snapshot_max_age_minutes");
}

function saveWeight(projectConfig) {
  return positiveNumber(varOrDefault(projectConfig, "discovery_save_score_weight", "2"), "discovery_save_score_weight");
}

function purchaseWeight(projectConfig) {
  return positiveNumber(varOrDefault(projectConfig, "discovery_purchase_score_weight", "5"), "discovery_purchase_score_weight");
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function positiveNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

module.exports = {
  artistEngagementTableName,
  cleanTableRef,
  eligibleEventsTableName,
  minimumAudience,
  purchaseWeight,
  rawTableRef,
  saveWeight,
  snapshotMaxAgeMinutes,
  snapshotTableName,
  trackPopularityTableName,
};
