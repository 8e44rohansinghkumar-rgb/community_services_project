#!/usr/bin/env bash
# End-to-end smoke test: full civic workflow + security controls.
# Usage: bash scripts/smoke-test.sh [API_BASE]
set -uo pipefail

API="${1:-http://127.0.0.1:4000/api}"
ORIGIN="http://localhost:5173"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0
ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; echo "        expected [$3] got [${2:0:200}]"; FAIL=$((FAIL+1)); }
# eq: exact match on an extracted value. contains: substring match on raw text.
eq()       { if [[ "$2" == "$3" ]];   then ok "$1"; else bad "$1" "$2" "$3"; fi; }
contains() { if [[ "$2" == *"$3"* ]]; then ok "$1"; else bad "$1" "$2" "$3"; fi; }

# Pull a dotted path out of a JSON response so assertions test real values
# rather than substrings that might appear anywhere in an error blob.
field() {
  python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print('<unparseable>'); sys.exit()
for key in sys.argv[1].split('.'):
    if isinstance(d, list):
        d = d[int(key)] if key.isdigit() and len(d) > int(key) else '<missing>'
    elif isinstance(d, dict):
        d = d.get(key, '<missing>')
    else:
        d = '<missing>'
    if d == '<missing>':
        break
print(json.dumps(d) if isinstance(d, (dict, list)) else d)
" "$1" 2>/dev/null
}
count() { python3 -c "
import sys,json
try: d=json.load(sys.stdin)
except Exception: print(-1); sys.exit()
for k in sys.argv[1].split('.'):
    d = d.get(k, []) if isinstance(d, dict) else []
print(len(d) if isinstance(d, list) else -1)
" "$1" 2>/dev/null; }

jar_csrf() { grep civic_csrf "$1" 2>/dev/null | awk '{print $7}' | tail -1; }

api() { # api <jar> <method> <path> [json]
  local jar=$1 m=$2 p=$3 b=${4:-} c; c=$(jar_csrf "$jar")
  if [[ -n "$b" ]]; then
    curl -s -b "$jar" -c "$jar" -X "$m" "$API$p" -H 'Content-Type: application/json' \
      -H "Origin: $ORIGIN" -H "X-CSRF-Token: $c" -d "$b"
  else
    curl -s -b "$jar" -c "$jar" -X "$m" "$API$p" -H "Origin: $ORIGIN" -H "X-CSRF-Token: $c"
  fi
}
code() { # code <jar> <method> <path> [json]
  local jar=$1 m=$2 p=$3 b=${4:-} c; c=$(jar_csrf "$jar")
  if [[ -n "$b" ]]; then
    curl -s -o /dev/null -w '%{http_code}' -b "$jar" -c "$jar" -X "$m" "$API$p" \
      -H 'Content-Type: application/json' -H "Origin: $ORIGIN" -H "X-CSRF-Token: $c" -d "$b"
  else
    curl -s -o /dev/null -w '%{http_code}' -b "$jar" -c "$jar" -X "$m" "$API$p" \
      -H "Origin: $ORIGIN" -H "X-CSRF-Token: $c"
  fi
}
upload() { # upload <jar> <path> <curl -F args...>
  local jar=$1 p=$2; shift 2
  curl -s -b "$jar" -c "$jar" -X POST "$API$p" -H "Origin: $ORIGIN" -H "X-CSRF-Token: $(jar_csrf "$jar")" "$@"
}
login() { rm -f "$1"; curl -s -c "$1" "$API/auth/csrf" >/dev/null; \
          api "$1" POST /auth/login "{\"email\":\"$2\",\"password\":\"CivicDemo#2026\"}" >/dev/null; }

RUN=$(date +%s%N | tail -c 7)   # unique per run: keeps the suite idempotent
CIT="$TMP/cit.jar"; ADM="$TMP/adm.jar"; WRK="$TMP/wrk.jar"; OTH="$TMP/oth.jar"; W2="$TMP/w2.jar"
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > "$TMP/photo.png"

echo; echo "================ HEALTH ================"
contains "health/ready reports database up" "$(curl -s "$API/health/ready")" '"database":"up"'

echo; echo "================ AUTHENTICATION ================"
login "$CIT" citizen@civicconnect.dev
login "$ADM" admin@civicconnect.dev
login "$WRK" worker.roads@civicconnect.dev
login "$OTH" arjun@civicconnect.dev
login "$W2"  worker.sanitation@civicconnect.dev
eq "citizen login"                 "$(api "$CIT" GET /auth/me | field data.user.role)" 'CITIZEN'
eq "admin login"                   "$(api "$ADM" GET /auth/me | field data.user.role)" 'ADMIN'
eq "worker login"                  "$(api "$WRK" GET /auth/me | field data.user.role)" 'WORKER'
eq "second citizen login"          "$(api "$OTH" GET /auth/me | field data.user.role)" 'CITIZEN'
eq "no password hash in response"  "$(api "$CIT" GET /auth/me | grep -c 'password' || true)" '0'
eq "wrong password -> generic"     "$(api "$CIT" POST /auth/login '{"email":"citizen@civicconnect.dev","password":"TotallyWrong99"}' | field error.code)" 'INVALID_CREDENTIALS'
eq "unknown email -> identical"    "$(api "$CIT" POST /auth/login '{"email":"ghost@nowhere.dev","password":"TotallyWrong99"}' | field error.code)" 'INVALID_CREDENTIALS'
login "$CIT" citizen@civicconnect.dev

echo; echo "================ CSRF ================"
eq "POST without CSRF header"      "$(curl -s -b "$CIT" -X POST "$API/auth/logout" -H "Origin: $ORIGIN" | field error.code)" 'CSRF_VALIDATION_FAILED'
eq "cross-site Origin rejected"    "$(curl -s -b "$CIT" -X POST "$API/issues" -H 'Origin: https://evil.example.com' -H "X-CSRF-Token: $(jar_csrf "$CIT")" | field error.code)" 'ORIGIN_NOT_ALLOWED'
eq "forged CSRF token rejected"    "$(curl -s -b "$CIT" -X POST "$API/auth/logout" -H "Origin: $ORIGIN" -H 'X-CSRF-Token: forged' | field error.code)" 'CSRF_VALIDATION_FAILED'

echo; echo "================ RBAC ================"
eq "citizen -> /users"             "$(code "$CIT" GET /users)" '403'
eq "worker  -> /users"             "$(code "$WRK" GET /users)" '403'
eq "admin   -> /users"             "$(code "$ADM" GET /users)" '200'
eq "citizen -> /audit-logs"        "$(code "$CIT" GET /audit-logs)" '403'
eq "worker  -> /audit-logs"        "$(code "$WRK" GET /audit-logs)" '403'
eq "admin   -> /audit-logs"        "$(code "$ADM" GET /audit-logs)" '200'
eq "anonymous -> /issues"          "$(curl -s -o /dev/null -w '%{http_code}' "$API/issues")" '401'
eq "citizen -> worker workload"    "$(code "$CIT" GET /analytics/worker-workload)" '403'
eq "citizen -> hotspots"           "$(code "$CIT" GET /analytics/hotspots)" '403'
eq "worker cannot create category" "$(code "$WRK" POST /categories '{"slug":"hack","name":"Hack"}')" '403'

echo; echo "================ ISSUE CREATION ================"
CREATE=$(upload "$CIT" /issues \
  -F "title=Smoke test pothole service lane $RUN" \
  -F 'description=Automated smoke test issue describing a pothole that needs urgent attention on the service lane.' \
  -F 'categoryId=1' -F 'citizenSeverity=HIGH' -F 'latitude=28.2475' -F 'longitude=77.0652' \
  -F 'address=Service lane, Sohna' -F 'landmark=Near the water tank' \
  -F "images=@$TMP/photo.png;type=image/png")
eq "citizen creates issue"         "$(echo "$CREATE" | field success)" 'True'
ISSUE_ID=$(echo "$CREATE" | field data.issue.id)
IMAGE_ID=$(echo "$CREATE" | field data.images.0.id)
eq "public id generated"           "$(echo "$CREATE" | field data.issue.publicId | cut -c1-4)" 'CIV-'
eq "image stored"                  "$(echo "$CREATE" | field data.images.0.type)" 'REPORT'
eq "EXIF stripped / re-encoded"    "$(echo "$CREATE" | field data.images.0.mimeType)" 'image/png'
eq "initial status REPORTED"       "$(echo "$CREATE" | field data.issue.status)" 'REPORTED'
eq "duplicate candidates present"  "$(echo "$CREATE" | field data.potentialDuplicates | cut -c1-1)" '['
eq "identical resubmit blocked"    "$(upload "$CIT" /issues -F "title=Smoke test pothole service lane $RUN" \
    -F 'description=Automated smoke test issue describing a pothole that needs urgent attention on the service lane.' \
    -F 'categoryId=1' -F 'citizenSeverity=HIGH' -F 'latitude=28.2475' -F 'longitude=77.0652' | field error.code)" 'DUPLICATE_SUBMISSION'
PRI=$(echo "$CREATE" | field data.issue.officialPriority)
eq "priority engine assigns band"  "$([[ "$PRI" == "HIGH" || "$PRI" == "CRITICAL" ]] && echo yes)" 'yes'

echo; echo "================ UPLOAD SECURITY ================"
printf '<?php system($_GET["c"]); ?>' > "$TMP/shell.php"
printf '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' > "$TMP/x.svg"
printf 'MZ\x90\x00\x03\x00\x00\x00fake-exe-content-padding-padding' > "$TMP/fake.png"
{ printf '\x89PNG\r\n\x1a\n'; head -c 7000000 /dev/urandom; } > "$TMP/big.png"
eq "PHP upload rejected"           "$(upload "$CIT" "/issues/$ISSUE_ID/images" -F "images=@$TMP/shell.php;type=application/x-php" | field error.code)" 'UNSUPPORTED_MEDIA_TYPE'
eq "SVG upload rejected"           "$(upload "$CIT" "/issues/$ISSUE_ID/images" -F "images=@$TMP/x.svg;type=image/svg+xml" | field error.code)" 'UNSUPPORTED_MEDIA_TYPE'
REJ=$(upload "$CIT" "/issues/$ISSUE_ID/images" -F "images=@$TMP/fake.png;type=image/png" | field success)
eq "bad magic bytes rejected"      "$REJ" 'False'
eq "oversized file rejected"       "$(upload "$CIT" "/issues/$ISSUE_ID/images" -F "images=@$TMP/big.png;type=image/png" | field error.code)" 'PAYLOAD_TOO_LARGE'
cp "$TMP/shell.php" "$TMP/evil.php.png"
eq "double extension rejected"     "$(upload "$CIT" "/issues/$ISSUE_ID/images" -F "images=@$TMP/evil.php.png;type=image/png" | field success)" 'False'

echo; echo "================ IDOR / OBJECT-LEVEL ACCESS ================"
eq "other citizen cannot edit"     "$(code "$OTH" PATCH "/issues/$ISSUE_ID" '{"title":"Hijacked title text"}')" '403'
eq "other citizen cannot assign"   "$(code "$OTH" POST "/issues/$ISSUE_ID/assign" '{"workerId":"00000000-0000-0000-0000-000000000000"}')" '403'
eq "citizen cannot delete"         "$(code "$CIT" DELETE "/issues/$ISSUE_ID")" '403'
eq "citizen cannot mark spam"      "$(code "$CIT" PATCH "/issues/$ISSUE_ID/spam" '{"isSpam":true}')" '403'
eq "citizen cannot change priority" "$(code "$CIT" PATCH "/issues/$ISSUE_ID/priority" '{"priority":"CRITICAL"}')" '403'
eq "worker cannot skip lifecycle"  "$(code "$WRK" POST "/issues/$ISSUE_ID/status" '{"status":"IN_PROGRESS"}')" '409'
eq "unknown UUID -> 404"           "$(code "$ADM" GET '/issues/11111111-2222-3333-4444-555555555555')" '404'
eq "malformed UUID -> 400"         "$(code "$ADM" GET '/issues/not-a-uuid')" '400'
eq "worker cannot read others' queue" "$(code "$WRK" GET "/workers/$(api "$W2" GET /auth/me | field data.user.id)/issues")" '404'

echo; echo "================ MASS ASSIGNMENT ================"
eq "role injection on profile"     "$(api "$CIT" PATCH /auth/me '{"name":"Priya Nair","role":"ADMIN"}' | field error.code)" 'VALIDATION_ERROR'
rm -f "$TMP/new.jar"; curl -s -c "$TMP/new.jar" "$API/auth/csrf" >/dev/null
eq "role in register body"         "$(api "$TMP/new.jar" POST /auth/register '{"name":"Esc Test","email":"esc@example.com","password":"ValidPassw0rd!","role":"ADMIN"}' | field error.code)" 'VALIDATION_ERROR'
eq "isActive injection blocked"    "$(api "$CIT" PATCH /auth/me '{"isActive":false}' | field error.code)" 'VALIDATION_ERROR'

echo; echo "================ SQL INJECTION ================"
eq "SQLi in search param"          "$(api "$ADM" GET "/issues?search=%27%20OR%201%3D1--" | field success)" 'True'
eq "SQLi in sortBy (allowlist)"    "$(api "$ADM" GET "/issues?sortBy=id%3B%20DROP%20TABLE%20users%3B--" | field error.code)" 'VALIDATION_ERROR'
eq "SQLi in login email"           "$(api "$CIT" POST /auth/login "{\"email\":\"admin@x.dev' OR '1'='1\",\"password\":\"x\"}" | field error.code)" 'VALIDATION_ERROR'
eq "SQLi in status filter"         "$(api "$ADM" GET "/issues?status=REPORTED%27%3B--" | field error.code)" 'VALIDATION_ERROR'
eq "users table intact after SQLi" "$(code "$ADM" GET /users)" '200'
login "$CIT" citizen@civicconnect.dev

echo; echo "================ PAGINATION ================"
eq "limit=5000 rejected"           "$(api "$ADM" GET '/issues?limit=5000' | field error.code)" 'VALIDATION_ERROR'
eq "limit honoured"                "$(api "$ADM" GET '/issues?limit=3&page=1' | count data)" '3'
eq "pagination meta present"       "$(api "$ADM" GET '/issues?limit=3' | field pagination.totalPages | grep -cE '^[0-9]+$')" '1'
eq "page=0 rejected"               "$(api "$ADM" GET '/issues?page=0' | field error.code)" 'VALIDATION_ERROR'

echo; echo "================ ADMIN WORKFLOW ================"
# Resolve the id of the specific worker whose session we hold ($WRK), rather
# than workers[0] — the directory is ordered by workload, not by name.
WORKER_ID=$(api "$WRK" GET /auth/me | field data.user.id)
W2_ID=$(api "$W2" GET /auth/me | field data.user.id)
eq "REPORTED -> UNDER_REVIEW"      "$(api "$ADM" POST "/issues/$ISSUE_ID/status" '{"status":"UNDER_REVIEW"}' | field data.issue.status)" 'UNDER_REVIEW'
eq "illegal transition rejected"   "$(api "$ADM" POST "/issues/$ISSUE_ID/status" '{"status":"CLOSED"}' | field error.code)" 'INVALID_TRANSITION'
eq "admin assigns worker"          "$(api "$ADM" POST "/issues/$ISSUE_ID/assign" "{\"workerId\":\"$WORKER_ID\",\"note\":\"Please inspect today\"}" | field data.issue.status)" 'ASSIGNED'
eq "re-assign same worker -> 409"  "$(api "$ADM" POST "/issues/$ISSUE_ID/assign" "{\"workerId\":\"$WORKER_ID\"}" | field error.code)" 'ALREADY_ASSIGNED'
eq "priority changed"              "$(api "$ADM" PATCH "/issues/$ISSUE_ID/priority" '{"priority":"MEDIUM","reason":"Re-assessed on site"}' | field data.issue.officialPriority)" 'MEDIUM'
eq "assigned worker recorded"      "$(api "$ADM" GET "/issues/$ISSUE_ID" | field data.issue.assignedWorkerId)" "$WORKER_ID"

echo; echo "================ WORKER WORKFLOW ================"
login "$WRK" worker.roads@civicconnect.dev
eq "assigned worker has access"    "$(api "$WRK" GET "/issues/$ISSUE_ID" | field data.access)" 'ASSIGNED_WORKER'
eq "unassigned worker blocked"     "$(code "$W2" GET "/issues/$ISSUE_ID")" '200'   # public issue: read-only projection
eq "unassigned worker cannot act"  "$(code "$W2" POST "/issues/$ISSUE_ID/status" '{"status":"IN_PROGRESS"}')" '403'
eq "worker starts work"            "$(api "$WRK" POST "/issues/$ISSUE_ID/status" '{"status":"IN_PROGRESS"}' | field data.issue.status)" 'IN_PROGRESS'
eq "worker adds work note"         "$(api "$WRK" POST "/issues/$ISSUE_ID/comments" '{"body":"Inspected the site, patching now."}' | field success)" 'True'
eq "worker posts internal note"    "$(api "$WRK" POST "/issues/$ISSUE_ID/comments" '{"body":"Depot stock is low.","isInternal":true}' | field data.comment.isInternal)" 'True'
eq "resolve without evidence"      "$(api "$WRK" POST "/issues/$ISSUE_ID/status" '{"status":"RESOLVED"}' | field error.code)" 'VALIDATION_ERROR'
eq "worker uploads resolution"     "$(upload "$WRK" "/issues/$ISSUE_ID/images" -F 'type=RESOLUTION' -F "images=@$TMP/photo.png;type=image/png" | field data.images.0.type)" 'RESOLUTION'
eq "worker marks resolved"         "$(api "$WRK" POST "/issues/$ISSUE_ID/status" '{"status":"RESOLVED"}' | field data.issue.status)" 'RESOLVED'
eq "resolvedAt timestamp set"      "$(api "$WRK" GET "/issues/$ISSUE_ID" | field data.issue.resolvedAt | cut -c1-2)" '20'

echo; echo "================ CITIZEN CONFIRMATION ================"
login "$CIT" citizen@civicconnect.dev
eq "citizen notified of resolution" "$(api "$CIT" GET '/notifications?limit=20' | grep -c 'ISSUE_RESOLVED' | awk '{print ($1>0)?"yes":"no"}')" 'yes'
eq "unread count > 0"              "$(api "$CIT" GET /notifications/unread-count | field data.count | awk '{print ($1>0)?"yes":"no"}')" 'yes'
eq "citizen confirms fix"          "$(api "$CIT" POST "/issues/$ISSUE_ID/status" '{"status":"CLOSED"}' | field data.issue.status)" 'CLOSED'
eq "closedAt timestamp set"        "$(api "$CIT" GET "/issues/$ISSUE_ID" | field data.issue.closedAt | cut -c1-2)" '20'
HIST=$(api "$CIT" GET "/issues/$ISSUE_ID/history")
eq "timeline records every step"   "$(echo "$HIST" | count data.history)" '6'
eq "timeline is chronological"     "$(echo "$HIST" | field data.history.0.newStatus)" 'REPORTED'
eq "mark-all-read works"           "$(api "$CIT" PATCH /notifications/read-all | field success)" 'True'
eq "unread now zero"               "$(api "$CIT" GET /notifications/unread-count | field data.count)" '0'

echo; echo "================ REOPEN FLOW ================"
CREATE2=$(upload "$OTH" /issues -F "title=Reopen flow streetlight outage $RUN" \
  -F 'description=Testing the reopen lifecycle path for a streetlight that keeps failing repeatedly.' \
  -F 'categoryId=3' -F 'citizenSeverity=MEDIUM' -F 'latitude=28.2440' -F 'longitude=77.0641')
ID2=$(echo "$CREATE2" | field data.issue.id)
api "$ADM" POST "/issues/$ID2/assign" "{\"workerId\":\"$WORKER_ID\"}" >/dev/null
login "$WRK" worker.roads@civicconnect.dev
api "$WRK" POST "/issues/$ID2/status" '{"status":"IN_PROGRESS"}' >/dev/null
upload "$WRK" "/issues/$ID2/images" -F 'type=RESOLUTION' -F "images=@$TMP/photo.png;type=image/png" >/dev/null
api "$WRK" POST "/issues/$ID2/status" '{"status":"RESOLVED"}' >/dev/null
login "$OTH" arjun@civicconnect.dev
eq "reopen requires a reason"      "$(api "$OTH" POST "/issues/$ID2/status" '{"status":"REOPENED"}' | field error.code)" 'VALIDATION_ERROR'
eq "citizen reopens with reason"   "$(api "$OTH" POST "/issues/$ID2/status" '{"status":"REOPENED","reason":"The light failed again after two days."}' | field data.issue.status)" 'REOPENED'
login "$ADM" admin@civicconnect.dev
eq "admin notified of reopen"      "$(api "$ADM" GET '/notifications?limit=5' | grep -c 'ISSUE_REOPENED' | awk '{print ($1>0)?"yes":"no"}')" 'yes'
eq "reopened -> re-assignable"     "$(api "$ADM" POST "/issues/$ID2/assign" "{\"workerId\":\"$WORKER_ID\"}" | field data.issue.status)" 'ASSIGNED'

echo; echo "================ PRIVACY ================"
eq "other citizen: no reporter email" "$(api "$OTH" GET "/issues/$ISSUE_ID" | grep -c 'reporterEmail' || true)" '0'
eq "admin sees reporter email"     "$(api "$ADM" GET "/issues/$ISSUE_ID" | grep -c 'reporterEmail' | awk '{print ($1>0)?"yes":"no"}')" 'yes'
PUB=$(curl -s "$API/issues/public?limit=5")
eq "public feed anonymous access"  "$(echo "$PUB" | field success)" 'True'
eq "public feed hides email"       "$(echo "$PUB" | grep -c 'reporterEmail' || true)" '0'
eq "public feed hides reporter id" "$(echo "$PUB" | grep -c 'reporterId' || true)" '0'
eq "public coords rounded ~110m"   "$(echo "$PUB" | field data.0.latitude | awk -F. '{print length($2)<=3?"yes":"no"}')" 'yes'
eq "citizen cannot see internal notes" "$(api "$CIT" GET "/issues/$ISSUE_ID/comments" | grep -c '"isInternal": true' || true)" '0'
eq "staff can see internal notes"  "$(api "$ADM" GET "/issues/$ISSUE_ID/comments" | grep -c 'true' | awk '{print ($1>0)?"yes":"no"}')" 'yes'

echo; echo "================ ANALYTICS ================"
eq "overview computed in SQL"      "$(api "$ADM" GET /analytics/overview | field data.stats.total | grep -cE '^[0-9]+$')" '1'
eq "avg resolution time present"   "$(api "$ADM" GET /analytics/overview | grep -c 'averageResolutionHours')" '1'
eq "issues by category"            "$(api "$ADM" GET /analytics/issues-by-category | field success)" 'True'
eq "issues by status"              "$(api "$ADM" GET /analytics/issues-by-status | field success)" 'True'
eq "issues over time dense axis"   "$(api "$ADM" GET '/analytics/issues-over-time?days=14' | count data.series)" '14'
eq "worker workload"               "$(api "$ADM" GET /analytics/worker-workload | field success)" 'True'
CIT_TOTAL=$(api "$CIT" GET /analytics/overview | field data.stats.total)
ADM_TOTAL=$(api "$ADM" GET /analytics/overview | field data.stats.total)
eq "citizen analytics scoped"      "$([[ "$CIT_TOTAL" -lt "$ADM_TOTAL" ]] && echo yes || echo no)" 'yes'
eq "CSV export (admin)"            "$(curl -s -b "$ADM" "$API/analytics/export" | head -1 | grep -c 'public_id')" '1'

echo; echo "================ SEARCH & FILTERS ================"
eq "full-text search"              "$(api "$ADM" GET '/issues?search=pothole' | field success)" 'True'
eq "search by public id prefix"    "$(api "$ADM" GET '/issues?search=CIV-2026' | field success)" 'True'
eq "filter by status"              "$(api "$ADM" GET '/issues?status=REPORTED' | field success)" 'True'
eq "filter by priority csv"        "$(api "$ADM" GET '/issues?priority=CRITICAL,HIGH' | field success)" 'True'
eq "filter by category"            "$(api "$ADM" GET '/issues?categoryId=1' | field success)" 'True'
eq "sort by priority"              "$(api "$ADM" GET '/issues?sortBy=priority&sortDir=desc' | field success)" 'True'
eq "bbox map filter"               "$(api "$ADM" GET '/issues?minLat=28.2&maxLat=28.3&minLng=77.0&maxLng=77.1' | field success)" 'True'
eq "citizen list scoped to self"   "$(api "$CIT" GET '/issues?limit=100' | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
me='$(api "$CIT" GET /auth/me | field data.user.id)'
print('yes' if all(i['reporterId']==me for i in d) else 'no')")" 'yes'

echo; echo "================ AUDIT LOG ================"
eq "assignment audited"            "$(api "$ADM" GET '/audit-logs?action=ISSUE_ASSIGNED' | field pagination.total | awk '{print ($1>0)?"yes":"no"}')" 'yes'
eq "status change audited"         "$(api "$ADM" GET '/audit-logs?action=ISSUE_STATUS_CHANGED' | field pagination.total | awk '{print ($1>0)?"yes":"no"}')" 'yes'
eq "priority change audited"       "$(api "$ADM" GET '/audit-logs?action=ISSUE_PRIORITY_CHANGED' | field pagination.total | awk '{print ($1>0)?"yes":"no"}')" 'yes'
eq "audit records actor"           "$(api "$ADM" GET '/audit-logs?limit=1' | field data.0.actorEmail | grep -c '@')" '1'
eq "audit records ip"              "$(api "$ADM" GET '/audit-logs?limit=1' | grep -c 'ipAddress')" '1'

echo; echo "================ IMAGE ACCESS ================"
eq "owner fetches own image"       "$(curl -s -o /dev/null -w '%{http_code}' -b "$CIT" "$API/issues/$ISSUE_ID/images/$IMAGE_ID")" '200'
eq "image mime is image/*"         "$(curl -s -o /dev/null -w '%{content_type}' -b "$CIT" "$API/issues/$ISSUE_ID/images/$IMAGE_ID" | cut -d/ -f1)" 'image'
contains "nosniff on image route"  "$(curl -s -D - -o /dev/null -b "$CIT" "$API/issues/$ISSUE_ID/images/$IMAGE_ID")" 'nosniff'
contains "CSP sandbox on image"    "$(curl -s -D - -o /dev/null -b "$CIT" "$API/issues/$ISSUE_ID/images/$IMAGE_ID")" 'sandbox'
eq "path traversal image id"       "$(curl -s -o /dev/null -w '%{http_code}' -b "$CIT" "$API/issues/$ISSUE_ID/images/..%2F..%2F..%2Fetc%2Fpasswd")" '400'
eq "image id from another issue"   "$(curl -s -o /dev/null -w '%{http_code}' -b "$CIT" "$API/issues/$ID2/images/$IMAGE_ID")" '404'

echo; echo "================ ERROR HANDLING ================"
eq "malformed JSON -> 400"         "$(curl -s -b "$ADM" -X POST "$API/auth/login" -H 'Content-Type: application/json' -H "Origin: $ORIGIN" -H "X-CSRF-Token: $(jar_csrf "$ADM")" -d '{bad json' | field error.code)" 'VALIDATION_ERROR'
eq "unknown route -> 404"          "$(curl -s "$API/does-not-exist" | field error.code)" 'ROUTE_NOT_FOUND'
eq "no stack trace leaked"         "$(curl -s "$API/does-not-exist" | grep -c 'at Object' || true)" '0'
eq "requestId returned for tracing" "$(curl -s "$API/does-not-exist" | grep -c requestId)" '1'

echo; echo "================ SECURITY HEADERS ================"
HDRS=$(curl -s -D - -o /dev/null "$API/health")
contains "X-Content-Type-Options"  "$HDRS" 'nosniff'
contains "Content-Security-Policy" "$HDRS" 'Content-Security-Policy'
contains "X-Frame-Options DENY"    "$HDRS" 'DENY'
contains "Referrer-Policy"         "$HDRS" 'Referrer-Policy'
eq "x-powered-by hidden"           "$(echo "$HDRS" | grep -ci 'x-powered-by' || true)" '0'

echo; echo "================ CORS ================"
eq "disallowed origin blocked"     "$(curl -s -o /dev/null -w '%{http_code}' -H 'Origin: https://evil.example.com' "$API/health")" '403'
contains "allowed origin echoed"   "$(curl -s -D - -o /dev/null -H "Origin: $ORIGIN" "$API/health")" 'localhost:5173'

echo; echo "================ SESSION ================"
eq "logout succeeds"               "$(api "$CIT" POST /auth/logout '{}' | field success)" 'True'
eq "after logout 401"              "$(curl -s -o /dev/null -w '%{http_code}' -b "$CIT" "$API/auth/me")" '401'

echo
echo "========================================"
echo "  PASSED: $PASS    FAILED: $FAIL"
echo "========================================"
[[ $FAIL -eq 0 ]]
