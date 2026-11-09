#!/bin/bash
# Temporary. Finds out what a process started by Mondium inherits, and how the new zygote dies.
export DISPLAY=:99
START='{"firstRunDone":true,"keepLoginsSet":true,"restoreSession":false,"language":"en","autoUpdateCheck":false}'
export ELECTRON_ENABLE_LOGGING=file
profile() { local P; P=$(mktemp -d); echo "$START" > "$P/ayarlar.json"; echo "$P"; }
report() {
  local name="$1" P="$2"
  sleep 10
  local pid; pid=$(pgrep -f '^/opt/Mondium/mondium --(remote|inspect)' | head -1 || true)
  local ui; ui=$(curl -s -m 3 http://127.0.0.1:9334/json | grep -c 'ui.html' || true)
  local fatal; fatal=$(grep -h FATAL "$P/log.txt" 2>/dev/null | cut -c1-110 | head -1)
  echo "RESULT $name: alive=$([ -n "$pid" ] && echo yes || echo no) window=$ui fatal=[$fatal]"
  pkill -f '^/opt/Mondium/mondium' || true; sleep 2; pkill -9 -f '^/opt/Mondium/mondium' || true; sleep 1
}
start_inspect() { /opt/Mondium/mondium --inspect=9230 --remote-debugging-port=9334 >/dev/null 2>&1 & sleep 6; }
SNAP='env | sort > "$0.env"; cat /proc/self/status > "$0.status"; cat /proc/self/limits > "$0.limits"; ls -l /proc/self/fd > "$0.fd"; cat /proc/self/oom_score_adj > "$0.oom"'

echo "### what is inherited"
P=$(profile); export MONDIUM_PROFILE=$P ELECTRON_LOG_FILE=$P/log.txt
sh -c "$SNAP" /tmp/from-bash
start_inspect
PID=$(pgrep -f '^/opt/Mondium/mondium --inspect' | head -1)
tr '\0' '\n' < /proc/$PID/environ | sort > /tmp/browser.environ
node tools/nnp-exp.cjs "process.mainModule.require('child_process').spawn('/bin/sh',['-c',$(node -p 'JSON.stringify(process.argv[1])' "$SNAP"),'/tmp/from-mondium'],{detached:true,stdio:'ignore'}).unref(); 1"
sleep 1
for k in env limits oom; do echo "--- diff $k (bash vs mondium child)"; diff /tmp/from-bash.$k /tmp/from-mondium.$k | cut -c1-200 || true; done
echo "--- diff status"; diff <(grep -E '^(Sig|Shd|Cap|NoNewPrivs|Seccomp|Groups|Umask|NSpid)' /tmp/from-bash.status) <(grep -E '^(Sig|Shd|Cap|NoNewPrivs|Seccomp|Groups|Umask|NSpid)' /tmp/from-mondium.status) || true
echo "--- fds"; cat /tmp/from-mondium.fd | cut -c30-200
pkill -f '^/opt/Mondium/mondium' || true; sleep 3; pkill -9 -f '^/opt/Mondium/mondium' || true

for i in 1 2; do
  echo "### round $i"
  # Same profile, started again from bash
  P=$(profile); export MONDIUM_PROFILE=$P ELECTRON_LOG_FILE=$P/log.txt
  start_inspect
  node tools/nnp-exp.cjs "process.mainModule.require('electron').app.quit(); 1"
  sleep 3
  /opt/Mondium/mondium --remote-debugging-port=9334 >/dev/null 2>&1 &
  report "same-profile-from-bash" "$P"

  # New profile, started by a running Mondium that stays open
  P=$(profile); export MONDIUM_PROFILE=$P ELECTRON_LOG_FILE=$P/log.txt
  start_inspect
  Q=$(profile)
  node tools/nnp-exp.cjs "process.mainModule.require('child_process').spawn('/opt/Mondium/mondium',['--remote-debugging-port=9335'],{detached:true,stdio:'ignore',env:{...process.env,MONDIUM_PROFILE:'$Q',ELECTRON_LOG_FILE:'$Q/log.txt'}}).unref(); 1"
  sleep 8
  echo "RESULT child-of-running-mondium: window=$(curl -s -m 3 http://127.0.0.1:9335/json | grep -c 'ui.html') fatal=[$(grep -h FATAL $Q/log.txt | cut -c1-110 | head -1)]"
  pkill -f '^/opt/Mondium/mondium' || true; sleep 3; pkill -9 -f '^/opt/Mondium/mondium' || true

  # After quit, env restored to what the browser itself got at start
  P=$(profile); export MONDIUM_PROFILE=$P ELECTRON_LOG_FILE=$P/log.txt
  start_inspect
  node tools/nnp-exp.cjs "const {app}=process.mainModule.require('electron'); const fs=process.mainModule.require('fs'); const env=Object.fromEntries(fs.readFileSync('/proc/self/environ','latin1').split('\0').filter(Boolean).map((l)=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)]})); process.mainModule.require('child_process').spawn('/bin/sh',['-c','while kill -0 \"\$1\" 2>/dev/null; do sleep 0.2; done; exec /opt/Mondium/mondium --remote-debugging-port=9334','x',String(process.pid)],{detached:true,stdio:'ignore',env}).unref(); app.quit(); 1"
  report "restart-with-original-env" "$P"

  # Plain restart under strace
  P=$(profile); export MONDIUM_PROFILE=$P ELECTRON_LOG_FILE=$P/log.txt
  start_inspect
  node tools/nnp-exp.cjs "const {app}=process.mainModule.require('electron'); process.mainModule.require('child_process').spawn('/bin/sh',['-c','while kill -0 \"\$1\" 2>/dev/null; do sleep 0.2; done; exec strace -f -tt -s 120 -o /tmp/st-$i.txt /opt/Mondium/mondium --remote-debugging-port=9334','x',String(process.pid)],{detached:true,stdio:'ignore'}).unref(); app.quit(); 1"
  report "restart-under-strace" "$P"
  echo "--- strace: lines before each trap"
  grep -n SIGTRAP /tmp/st-$i.txt | head -5 | cut -c1-160 || true
  T=$(grep -n SIGTRAP /tmp/st-$i.txt | head -1 | cut -d: -f1)
  if [ -n "$T" ]; then TP=$(sed -n "${T}p" /tmp/st-$i.txt | awk '{print $1}'); head -n "$T" /tmp/st-$i.txt | grep "^$TP " | tail -60 | cut -c1-200; fi
done
sudo apt-get install -y gdb > /dev/null 2>&1 || true
C=$(ls -t /var/lib/systemd/coredump/core.mondium.* 2>/dev/null | tail -1 || true)
echo "core: $C"
