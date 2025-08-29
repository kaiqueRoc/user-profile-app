#!/usr/bin/env bash
# Simple E2E smoke test for user-profile-app (uses gateway at localhost:3001)
set -euo pipefail
GATEWAY="http://localhost:3001"
# register users (ignore errors)
curl -s -X POST $GATEWAY/api/auth/register -H "Content-Type: application/json" -d '{"email":"e2e_a@example.com","password":"password123","displayName":"E2E A"}' || true
curl -s -X POST $GATEWAY/api/auth/register -H "Content-Type: application/json" -d '{"email":"e2e_b@example.com","password":"password123","displayName":"E2E B"}' || true
# login users
TOK_A=$(curl -s -X POST $GATEWAY/api/auth/login -H "Content-Type: application/json" -d '{"email":"e2e_a@example.com","password":"password123"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
TOK_B=$(curl -s -X POST $GATEWAY/api/auth/login -H "Content-Type: application/json" -d '{"email":"e2e_b@example.com","password":"password123"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -z "$TOK_A" ] || [ -z "$TOK_B" ]; then echo "Failed to login users"; exit 2; fi
# A creates a post
POST_ID=$(curl -s -X POST $GATEWAY/api/posts -H "Content-Type: application/json" -H "Authorization: Bearer $TOK_A" -d '{"content":"E2E: hello from A"}' | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
if [ -z "$POST_ID" ]; then echo "Failed to create post"; exit 3; fi
# B follows A
# get A profile to obtain userId
ME_A_JSON=$(curl -s -H "Authorization: Bearer $TOK_A" $GATEWAY/api/profiles/me)
USER_A_ID=$(echo "$ME_A_JSON" | sed -n 's/.*"userId":"\([^"]*\)".*/\1/p')
curl -s -X POST $GATEWAY/api/profiles/$USER_A_ID/follow -H "Authorization: Bearer $TOK_B" -H 'Content-Type: application/json' -d '{}' >/dev/null
# B likes post
curl -s -X POST $GATEWAY/api/posts/$POST_ID/like -H "Authorization: Bearer $TOK_B" -H 'Content-Type: application/json' -d '{}' >/dev/null
# Give a small pause for DB
sleep 1
# A fetches notifications
NOTIFS=$(curl -s -H "Authorization: Bearer $TOK_A" $GATEWAY/api/notifications/$USER_A_ID)
echo "Notifications for A: $NOTIFS"
if echo "$NOTIFS" | grep -q "like"; then echo "E2E OK"; exit 0; else echo "E2E failed: like not found"; exit 4; fi
