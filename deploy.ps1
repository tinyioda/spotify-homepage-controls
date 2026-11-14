# Deploys this repo's files to the Docker VM (10.10.10.10) and rebuilds
# spotify-now-playing. Idempotent: the custom.js/custom.css block is
# marker-delimited, so re-running this replaces it in place instead of
# duplicating or going stale.
# Run from PowerShell (not Bash/Git-Bash — see ssh-windows-setup memory:
# bare `ssh`/Bash's ssh don't see the Windows ssh-agent on this machine).

$ssh = "$env:WINDIR\System32\OpenSSH\ssh.exe"
$scp = "$env:WINDIR\System32\OpenSSH\scp.exe"
$host_ = 'justin@10.10.10.10'
$repo = $PSScriptRoot

Write-Host 'Copying spotify-now-playing service files...'
& $scp "$repo\spotify-now-playing\server.js" "$repo\spotify-now-playing\compose.yaml" `
    "$repo\spotify-now-playing\Dockerfile" "$repo\spotify-now-playing\package.json" `
    "${host_}:/opt/stacks/spotify-now-playing/"

Write-Host 'Appending spotify-controls.js/.css into homepage custom.js/custom.css (if not already present)...'
& $scp "$repo\homepage\spotify-controls.js" "$repo\homepage\spotify-controls.css" "${host_}:/tmp/"
& $ssh $host_ @'
set -e
BEGIN="/\* spotify-controls:begin \*/"
END="/\* spotify-controls:end \*/"
for f in /opt/appdata/homepage/custom.js /opt/appdata/homepage/custom.css; do
  sed -i "/$BEGIN/,/$END/d" "$f"
done
{ echo "/* spotify-controls:begin */"; cat /tmp/spotify-controls.js; echo "/* spotify-controls:end */"; } >> /opt/appdata/homepage/custom.js
{ echo "/* spotify-controls:begin */"; cat /tmp/spotify-controls.css; echo "/* spotify-controls:end */"; } >> /opt/appdata/homepage/custom.css
rm -f /tmp/spotify-controls.js /tmp/spotify-controls.css
'@

Write-Host 'Rebuilding spotify-now-playing...'
& $ssh $host_ 'cd /opt/stacks/spotify-now-playing && docker compose up -d --build'

Write-Host ''
Write-Host 'Done. Homepage picks up custom.js/custom.css live (no-cache headers already configured).'
Write-Host 'If /play or /pause returns 403 forbidden_scope, re-authorize with the wider scope — see spotify-now-playing/README.md.'
