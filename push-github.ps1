$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "====================================="
Write-Host "  BUILD + GITHUB PUSH"
Write-Host "====================================="
Write-Host ""

# Repo kontrolü
if (-not (Test-Path ".git")) {
    Write-Host "HATA: Bu klasor bir Git repository degil."
    exit 1
}

$branch = git branch --show-current

if ([string]::IsNullOrWhiteSpace($branch)) {
    Write-Host "HATA: Aktif branch bulunamadi."
    exit 1
}

Write-Host "Branch: $branch"

Write-Host ""
Write-Host "Remote:"
git remote -v

# ---------------------------------------
# BUILD
# ---------------------------------------

Write-Host ""
Write-Host ">>> npm run build"
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "BUILD FAILED - GitHub'a push YAPILMADI."
    exit 1
}

Write-Host ""
Write-Host "BUILD PASS"

# ---------------------------------------
# GIT STATUS
# ---------------------------------------

Write-Host ""
Write-Host ">>> git status"
git status --short

$changes = git status --porcelain

if (-not [string]::IsNullOrWhiteSpace($changes)) {

    Write-Host ""
    Write-Host "Degisiklikler bulundu."

    git add -A

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

    git commit -m "Auto update - $timestamp"

    if ($LASTEXITCODE -ne 0) {
        Write-Host "COMMIT FAILED"
        exit 1
    }

}
else {
    Write-Host ""
    Write-Host "Yeni commit gerektiren degisiklik yok."
}

# ---------------------------------------
# PUSH
# ---------------------------------------

Write-Host ""
Write-Host ">>> GitHub push"

git push origin $branch

if ($LASTEXITCODE -ne 0) {

    Write-Host ""
    Write-Host "Normal push basarisiz. Upstream deneniyor..."

    git push -u origin $branch

    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "GITHUB PUSH FAILED"
        exit 1
    }
}

# ---------------------------------------
# VERIFY
# ---------------------------------------

Write-Host ""
Write-Host ">>> Push dogrulaniyor..."

$localSha = (git rev-parse HEAD).Trim()

$remoteResult = git ls-remote origin "refs/heads/$branch"

if ([string]::IsNullOrWhiteSpace($remoteResult)) {
    Write-Host "REMOTE SHA ALINAMADI"
    exit 1
}

$remoteSha = ($remoteResult -split "\s+")[0].Trim()

Write-Host ""
Write-Host "LOCAL : $localSha"
Write-Host "REMOTE: $remoteSha"

if ($localSha -ne $remoteSha) {

    Write-Host ""
    Write-Host "HATA: LOCAL ve REMOTE SHA AYNI DEGIL!"
    exit 1
}

Write-Host ""
Write-Host "====================================="
Write-Host " PUSH VERIFIED"
Write-Host "====================================="
Write-Host ""
Write-Host "Branch : $branch"
Write-Host "Commit : $localSha"
Write-Host ""

git status