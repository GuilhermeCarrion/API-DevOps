# Tarefas API — Docker, Kubernetes, Prometheus e Grafana

API REST de tarefas (Node.js + Express) com PostgreSQL e Redis, empacotada em Docker, com deploy por Docker Compose e Kubernetes, métricas no Prometheus, e dashboard e alertas no Grafana.

```
            ┌──────────── Prometheus ◄──── cAdvisor / kubelet (métricas dos containers)
            │   (scrape /metrics)
 cliente ─► API (Node) ──► PostgreSQL (dados)
                      └──► Redis (cache do GET /tasks)
            Grafana ◄── Prometheus   →  dashboard + alertas (Discord)
```

## Estrutura

| Caminho | O que é |
|---|---|
| `app/` | Código da API e `Dockerfile` |
| `docker-compose.yml` | Stack completa: app, Postgres, Redis, cAdvisor, Prometheus, Grafana |
| `k8s/` | Manifests Kubernetes (Deployments, StatefulSet, Services, RBAC) |
| `kustomization.yaml` | Junta os manifests e gera ConfigMaps/Secret a partir das configs |
| `monitoring/prometheus/` | Configuração do Prometheus (compose e k8s) |
| `monitoring/grafana/` | Datasource, dashboard e regras de alerta provisionados automaticamente |
| `scripts/deploy.ps1` | Build da imagem e deploy completo no Kubernetes |
| `.github/workflows/ci.yml` | CI: valida manifests, sobe a stack, roda smoke test e publica a imagem no GHCR |

## Configuração

```powershell
Copy-Item .env.example .env
```

Edite `.env` e coloque a URL do webhook do Discord em `DISCORD_WEBHOOK_URL`. Para criar o webhook, abra o servidor do Discord e vá em **Configurações do canal → Integrações → Webhooks → Novo webhook → Copiar URL**.

## Rodar com Docker Compose

```powershell
docker compose up -d --build
```

| Serviço | URL |
|---|---|
| API | http://localhost:3000/tasks |
| Métricas da API | http://localhost:3000/metrics |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3001 (admin / admin) |
| cAdvisor | http://localhost:8080 |

## Rodar no Kubernetes (Docker Desktop)

Ative o Kubernetes em **Docker Desktop → Settings → Kubernetes**. Depois rode:

```powershell
./scripts/deploy.ps1
```

| Serviço | URL |
|---|---|
| API | http://localhost:30000/tasks |
| Prometheus | http://localhost:30090 |
| Grafana | http://localhost:30300 |

Se as NodePorts não responderem (cluster em modo kind), use port-forward:

```powershell
kubectl -n tarefas port-forward svc/grafana 30300:3000
```

Para remover tudo: `kubectl delete -k .`

## Endpoints da API

| Método | Rota | Descrição |
|---|---|---|
| GET | `/tasks` | Lista tarefas (com cache no Redis por 30s) |
| POST | `/tasks` | Cria tarefa: `{"title": "..."}` |
| PATCH | `/tasks/:id` | Alterna concluída/não concluída |
| DELETE | `/tasks/:id` | Remove tarefa |
| GET | `/health` | Verifica banco e cache (usado nas probes) |
| GET | `/metrics` | Métricas no formato Prometheus |
| GET | `/simulate/error` | Retorna 500 (para testar o alerta de taxa de erro) |

## Métricas e alertas

A API expõe estas métricas:

- `http_requests_total{method,route,status}`
- `http_request_duration_seconds` (histograma)
- `cache_requests_total{result=hit|miss}`
- métricas padrão do Node (CPU, memória, event loop, GC)

As métricas dos containers vêm do cAdvisor no Compose e do cAdvisor embutido no kubelet no Kubernetes.

Alertas provisionados no Grafana, todos enviados para o Discord:

| Alerta | Condição |
|---|---|
| App fora do ar | nenhuma instância respondendo por 1 min |
| Taxa de erro alta | mais de 10% de respostas 5xx por 1 min |
| Memória alta na API | processo acima de 200 MB por 2 min |

### Gerar tráfego e disparar alertas (para os prints)

```powershell
# tráfego normal (troque a porta para 30000 no Kubernetes)
1..300 | % { irm http://localhost:3000/tasks > $null; Start-Sleep -Milliseconds 200 }

# dispara "Taxa de erro alta"
1..300 | % { try { irm http://localhost:3000/simulate/error } catch {}; Start-Sleep -Milliseconds 200 }

# dispara "App fora do ar" no Kubernetes
kubectl -n tarefas scale deployment/app --replicas=0
# ...depois volte:
kubectl -n tarefas scale deployment/app --replicas=2
```
