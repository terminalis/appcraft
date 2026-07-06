#!/usr/bin/env bash
# Zero-bugs gate: fail unless the fresh SonarQube Cloud analysis has ZERO open
# issues impacting SECURITY or RELIABILITY — the paper's methodology as a hard
# CI wall. Enforced via the Web API because custom quality gates need a paid
# plan; Accepted issues are resolved=true and intentionally do not count.
#
# Scope caveat (red-tested 2026-07-06): PR-scope attribution only works when
# the PR's TARGET branch has a Sonar analysis — true for main, the normal case.
# A PR into a never-analyzed feature branch can pass vacuously; the
# branch-scope run on every main push is the authoritative wall either way.
set -euo pipefail

API=https://sonarcloud.io/api
PROJECT_KEY=$(grep '^sonar.projectKey=' sonar-project.properties | cut -d= -f2)
CE_TASK_ID=$(grep '^ceTaskId=' .scannerwork/report-task.txt | cut -d= -f2)

json() { node -pe "JSON.parse(require('fs').readFileSync(0,'utf8'))$1"; }

# The scanner upload is processed asynchronously server-side; wait for it so
# the issue search below sees this run's analysis, not the previous one.
status=PENDING
for _ in $(seq 1 60); do
  status=$(curl -sf -u "$SONAR_TOKEN:" "$API/ce/task?id=$CE_TASK_ID" | json .task.status)
  [ "$status" = SUCCESS ] && break
  case "$status" in FAILED|CANCELED) echo "Analysis processing ended: $status"; exit 1 ;; esac
  sleep 5
done
if [ "$status" != SUCCESS ]; then
  echo "Timed out waiting for analysis processing (last status: $status)"
  exit 1
fi

# Scope to what this run analyzed: the PR, or the pushed branch.
if [ -n "${PR_NUMBER:-}" ]; then
  scope="pullRequest=$PR_NUMBER"
else
  scope="branch=$GITHUB_REF_NAME"
fi

resp=$(curl -sf -u "$SONAR_TOKEN:" \
  "$API/issues/search?componentKeys=$PROJECT_KEY&$scope&resolved=false&impactSoftwareQualities=SECURITY,RELIABILITY&ps=50")
total=$(echo "$resp" | json .total)

if [ "$total" != 0 ]; then
  echo "ZERO-BUGS GATE FAILED: $total open Security/Reliability issue(s) in generated output ($scope):"
  echo "$resp" | node -e '
    const j = JSON.parse(require("fs").readFileSync(0, "utf8"));
    for (const i of j.issues) {
      const q = (i.impacts || []).map(x => x.softwareQuality).join("/");
      console.log(` - [${q}] ${i.component.split(":").pop()}:${i.line ?? "-"} ${i.message} (${i.rule})`);
    }
  '
  exit 1
fi
echo "Zero-bugs gate passed: 0 open Security/Reliability issues in generated output ($scope)."
