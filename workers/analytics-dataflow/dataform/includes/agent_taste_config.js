function vars(projectConfig) {
  return projectConfig.vars || {};
}

function varOrDefault(projectConfig, name, fallbackValue) {
  const value = vars(projectConfig)[name];
  return value === undefined || value === null || value === "" ? fallbackValue : value;
}

function requiredVar(projectConfig, name) {
  const value = vars(projectConfig)[name];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required Dataform compilation variable: ${name}`);
  }
  return value;
}

function quotedTableRef(projectConfig, tableVarName, fallbackTableName) {
  const project = requiredVar(projectConfig, "analytics_project");
  const dataset = requiredVar(projectConfig, "analytics_dataset");
  const table = varOrDefault(projectConfig, tableVarName, fallbackTableName);
  return `\`${project}.${dataset}.${table}\``;
}

function cleanTableRef(projectConfig) {
  return quotedTableRef(projectConfig, "clean_table", "events_clean");
}

function trainingTableName(projectConfig) {
  return varOrDefault(projectConfig, "training_table", "user_track_signal_training");
}

function scoresTableName(projectConfig) {
  return varOrDefault(projectConfig, "scores_table", "user_track_recommendation_scores");
}

function modelVersion(projectConfig) {
  return varOrDefault(projectConfig, "model_version", "baseline-weighted-signals/v2");
}

function freshnessHours(projectConfig) {
  return varOrDefault(projectConfig, "freshness_hours", "2");
}

module.exports = {
  cleanTableRef,
  freshnessHours,
  modelVersion,
  scoresTableName,
  trainingTableName,
};
