# Provisiona tudo no Kubernetes local (Docker Desktop): build da imagem + apply dos manifests.
Set-Location (Join-Path $PSScriptRoot '..')

if (-not (Test-Path .env)) { Copy-Item .env.example .env; Write-Host 'Criado .env a partir do .env.example' }

docker build -t tarefas-api:local ./app
if ($LASTEXITCODE) { exit $LASTEXITCODE }

kubectl apply -k .
if ($LASTEXITCODE) { exit $LASTEXITCODE }

foreach ($r in 'statefulset/db', 'deployment/redis', 'deployment/app', 'deployment/prometheus', 'deployment/grafana') {
  kubectl -n tarefas rollout status $r --timeout=180s
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
}

kubectl -n tarefas get all
Write-Host "`nAPI: http://localhost:30000  Prometheus: http://localhost:30090  Grafana: http://localhost:30300"
