#!/usr/bin/env bash
# Reads changed file paths on stdin, one per line. Prints "true" when the simulator stage must run, else "false" (#59).
# It must run for anything under app/ or contract/, and for the files that run the stage itself. An empty list
# prints "true": when the change list is unknown, the stage runs.
set -u
need=false; any=false
while IFS= read -r f; do
  [ -n "$f" ] || continue
  any=true
  case "$f" in
    app/*|contract/*|.github/workflows/ci.yml|tools/ci-sim.sh|tools/ci-preflight.sh|tools/ci-clean.sh|tools/needs-simulator.sh) need=true;;
  esac
done
[ "$any" = true ] || need=true
echo "$need"
