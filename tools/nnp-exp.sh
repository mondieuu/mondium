#!/bin/bash
# Temporary. Starts Mondium in different ways and reports whether its window survives.
export DISPLAY=:99
START='{"firstRunDone":true,"keepLoginsSet":true,"restoreSession":false,"language":"en","autoUpdateCheck":false}'
report() {
  local name="$1" P="$2"
  sleep 10
  local pid; pid=$(pgrep -f '^/opt/Mondium/mondium --(remote|inspect)' | head -1 || true)
  local nnp='-'; [ -n "$pid" ] && nnp=$(awk '/NoNewPrivs/{print $2}' /proc/$pid/status)
  local ui; ui=$(curl -s -m 3 http://127.0.0.1:9334/json | grep -c 'ui.html' || true)
  local fatal; fatal=$(grep -h FATAL "$P/log.txt" 2>/dev/null | cut -c1-120 | head -1)
  echo "RESULT $name: alive=$([ -n "$pid" ] && echo yes || echo no) NoNewPrivs=$nnp window=$ui fatal=[$fatal]"
  pkill -f '^/opt/Mondium/mondium' || true
  sleep 2
  pkill -9 -f '^/opt/Mondium/mondium' || true
  sleep 1
}
profile() { local P; P=$(mktemp -d); echo "$START" > "$P/ayarlar.json"; echo "$P"; }
for i in 1 2 3; do
  P=$(profile); export MONDIUM_PROFILE=$P ELECTRON_ENABLE_LOGGING=file ELECTRON_LOG_FILE=$P/log.txt
  /opt/Mondium/mondium --remote-debugging-port=9334 >/dev/null 2>&1 &
  report "plain-start" "$P"

  P=$(profile); export MONDIUM_PROFILE=$P ELECTRON_LOG_FILE=$P/log.txt
  setpriv --no-new-privs /opt/Mondium/mondium --remote-debugging-port=9334 >/dev/null 2>&1 &
  report "no-new-privs-start" "$P"

  P=$(profile); export MONDIUM_PROFILE=$P ELECTRON_LOG_FILE=$P/log.txt
  /opt/Mondium/mondium --inspect=9230 --remote-debugging-port=9334 >/dev/null 2>&1 &
  sleep 6
  node tools/nnp-exp.cjs "const {app}=process.mainModule.require('electron'); const r=app.relaunch(); app.quit(); r"
  report "app-relaunch-no-update" "$P"

  P=$(profile); export MONDIUM_PROFILE=$P ELECTRON_LOG_FILE=$P/log.txt
  /opt/Mondium/mondium --inspect=9230 --remote-debugging-port=9334 >/dev/null 2>&1 &
  sleep 6
  node tools/nnp-exp.cjs "const {app}=process.mainModule.require('electron'); process.mainModule.require('child_process').spawn('/bin/sh',['-c','while kill -0 \"\$1\" 2>/dev/null; do sleep 0.2; done; exec /opt/Mondium/mondium --remote-debugging-port=9334','x',String(process.pid)],{detached:true,stdio:'ignore'}).unref(); app.quit(); 1"
  report "node-spawn-restart" "$P"
done
