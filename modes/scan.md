# Modo: scan — Guided Portal Scanner（方向确认后的岗位扫描）

这个模式的目标不是一上来就全网扫描，而是先根据用户资料确定求职方向，再把方向转成筛选条件，用户确认后才开始采集岗位。

人话解释：

- 先想清楚“该找什么方向”
- 再决定“用什么关键词和筛选条件”
- 用户确认后才跑扫描
- 扫描结果只写进 `data/pipeline.md`，后续再由 pipeline 做评估

---

## 当前默认入口流程（必须优先执行）

当用户执行 `/zhicheng scan` 时，默认按下面流程走：

1. **读取用户资料**
   - `cv.md`
   - `config/profile.yml`
   - `modes/_profile.md`
   - 可选：`article-digest.md`

2. **AI 发散多个相关方向**
   - 基于用户履历、目标角色、城市、薪资、技能优势，给出 3-5 个求职方向
   - 每个方向要说明：
     - 适合原因
     - 风险或短板
     - 推荐关键词
     - 适合的城市/行业/公司类型

3. **等待用户选择方向**
   - 如果用户没有明确选择，不要开始扫描
   - 可以推荐一个默认方向，但必须让用户确认

4. **AI 生成筛选条件**
   - 基于用户选择的方向和用户资料，生成可执行筛选条件
   - Boss 场景要尽量转换成这些字段：
     - `query` / `queries`
     - `city`
     - `pageSize`
     - `maxPages`
     - `filters.degreeAtLeast`
     - `filters.expMinYears`
     - `filters.expMaxYears`
     - `filters.salaryMinK`
     - `filters.salaryMaxK`
     - `filters.companyScaleInclude`
     - `filters.industryInclude`
     - `filters.keywordInclude`
     - `filters.keywordExclude`

5. **等待用户确认筛选条件**
   - 展示“本次将如何扫描”
   - 用户确认后才执行
   - 如果用户修改条件，先更新条件，再次确认

6. **按确认条件采集**
   - 非 Boss 网站按原 portal scan 流程执行
   - Boss 网站优先使用当前项目的 Boss 采集链路
   - 不并发跑 Boss
   - 出现 `code 37`、`security-check`、`请稍候`、`环境异常` 时停止 Boss 采集

7. **写入 pipeline**
   - 只把通过筛选的新岗位写入 `data/pipeline.md`
   - 同步写入 `data/scan-history.tsv`

8. **提示下一步**
   - 告诉用户可以运行 `/zhicheng pipeline`
   - pipeline 后续会做：初评打分 → 高分岗位拿详情 JD → 深度评估 → 报告/PDF/追踪

### 例外：用户已经给出明确方向和筛选条件

如果用户调用 `/zhicheng scan` 时已经明确给出方向和筛选条件，例如：

```text
/zhicheng scan 方向：SQE；城市：佛山；经验：3-10年；学历：大专以上；排除实习/外包
```

则可以跳过“方向发散”和“方向选择”，但仍然必须展示即将执行的筛选条件，并等待用户确认后再采集。

---

## 默认方向建议（根据当前用户资料）

如果用户没有提供新约束，优先基于 `config/profile.yml` 和 `modes/_profile.md` 给出这些方向：

1. **SQE / 供应商质量工程师**
   - 主方向
   - 关键词：`SQE`、`供应商质量工程师`、`供应商质量`
   - 适合原因：用户有质量业务、供应商协同、测试与改进经验

2. **制造 / 研发质量工程师**
   - 补充方向
   - 关键词：`质量工程师`、`研发质量工程师`
   - 适合原因：可以承接质量分析、认证协同、异常处理经验

3. **质量体系 / 质量数字化工程师**
   - 探索方向
   - 关键词：`质量系统工程师`、`质量数字化`、`质量体系工程师`
   - 适合原因：用户有质量数据资产化、LIMS/API、自动化系统建设经历

4. **测试数据 / 质量数据分析**
   - 探索方向
   - 关键词：`测试数据工程师`、`质量数据分析`
   - 适合原因：用户有 20000+ 份历史测试报告结构化和数据治理项目

---

## Boss 默认安全扫描条件

如果用户选择 Boss 采集，默认使用中保守条件：

- 每次 1 个方向
- 每次 1 个城市
- 每次 1-2 页
- 每页 10 条以内
- 不并发
- 列表先筛选，详情后置
- 详情接口每随机 10-30 分钟最多 1 次
- 出现 `code 37` / `环境异常` / `security-check` / `请稍候` 后停止本轮 Boss 采集

---

## 原 portal scan 能力

## Ejecución recomendada

Ejecutar como subagente para no consumir contexto del main:

```
Agent(
    subagent_type="general-purpose",
    prompt="[contenido de este archivo + datos específicos]",
    run_in_background=True
)
```

## Configuración

Leer `portals.yml` que contiene:
- `search_queries`: Lista de queries WebSearch con `site:` filters por portal (descubrimiento amplio)
- `tracked_companies`: Empresas específicas con `careers_url` para navegación directa
- `title_filter`: Keywords positive/negative/seniority_boost para filtrado de títulos

## Estrategia de descubrimiento (3 niveles)

### Nivel 1 — Playwright directo (PRINCIPAL)

**Para cada empresa en `tracked_companies`:** Navegar a su `careers_url` con Playwright (`browser_navigate` + `browser_snapshot`), leer TODOS los job listings visibles, y extraer título + URL de cada uno. Este es el método más fiable porque:
- Ve la página en tiempo real (no resultados cacheados de Google)
- Funciona con SPAs (Ashby, Lever, Workday)
- Detecta ofertas nuevas al instante
- No depende de la indexación de Google

**Cada empresa DEBE tener `careers_url` en portals.yml.** Si no la tiene, buscarla una vez, guardarla, y usar en futuros scans.

### Nivel 2 — Greenhouse API (COMPLEMENTARIO)

Para empresas con Greenhouse, la API JSON (`boards-api.greenhouse.io/v1/boards/{slug}/jobs`) devuelve datos estructurados limpios. Usar como complemento rápido de Nivel 1 — es más rápido que Playwright pero solo funciona con Greenhouse.

### Nivel 3 — WebSearch queries (DESCUBRIMIENTO AMPLIO)

Los `search_queries` con `site:` filters cubren portales de forma transversal (todos los Ashby, todos los Greenhouse, etc.). Útil para descubrir empresas NUEVAS que aún no están en `tracked_companies`, pero los resultados pueden estar desfasados.

**Prioridad de ejecución:**
1. Nivel 1: Playwright → todas las `tracked_companies` con `careers_url`
2. Nivel 2: API → todas las `tracked_companies` con `api:`
3. Nivel 3: WebSearch → todos los `search_queries` con `enabled: true`

Los niveles son aditivos — se ejecutan todos, los resultados se mezclan y deduplicar.

## Workflow

1. **Leer configuración**: `portals.yml`
2. **Leer historial**: `data/scan-history.tsv` → URLs ya vistas
3. **Leer dedup sources**: `data/applications.md` + `data/pipeline.md`

4. **Nivel 1 — Playwright scan** (paralelo en batches de 3-5):
   Para cada empresa en `tracked_companies` con `enabled: true` y `careers_url` definida:
   a. `browser_navigate` a la `careers_url`
   b. `browser_snapshot` para leer todos los job listings
   c. Si la página tiene filtros/departamentos, navegar las secciones relevantes
   d. Para cada job listing extraer: `{title, url, company}`
   e. Si la página pagina resultados, navegar páginas adicionales
   f. Acumular en lista de candidatos
   g. Si `careers_url` falla (404, redirect), intentar `scan_query` como fallback y anotar para actualizar la URL

5. **Nivel 2 — Greenhouse APIs** (paralelo):
   Para cada empresa en `tracked_companies` con `api:` definida y `enabled: true`:
   a. WebFetch de la URL de API → JSON con lista de jobs
   b. Para cada job extraer: `{title, url, company}`
   c. Acumular en lista de candidatos (dedup con Nivel 1)

6. **Nivel 3 — WebSearch queries** (paralelo si posible):
   Para cada query en `search_queries` con `enabled: true`:
   a. Ejecutar WebSearch con el `query` definido
   b. De cada resultado extraer: `{title, url, company}`
      - **title**: del título del resultado (antes del " @ " o " | ")
      - **url**: URL del resultado
      - **company**: después del " @ " en el título, o extraer del dominio/path
   c. Acumular en lista de candidatos (dedup con Nivel 1+2)

6. **Filtrar por título** usando `title_filter` de `portals.yml`:
   - Al menos 1 keyword de `positive` debe aparecer en el título (case-insensitive)
   - 0 keywords de `negative` deben aparecer
   - `seniority_boost` keywords dan prioridad pero no son obligatorios

7. **Deduplicar** contra 3 fuentes:
   - `scan-history.tsv` → URL exacta ya vista
   - `applications.md` → empresa + rol normalizado ya evaluado
   - `pipeline.md` → URL exacta ya en pendientes o procesadas

7.5. **Verificar liveness de resultados de WebSearch (Nivel 3)** — ANTES de añadir a pipeline:

   Los resultados de WebSearch pueden estar desactualizados (Google cachea resultados durante semanas o meses). Para evitar evaluar ofertas expiradas, verificar con Playwright cada URL nueva que provenga del Nivel 3. Los Niveles 1 y 2 son inherentemente en tiempo real y no requieren esta verificación.

   Para cada URL nueva de Nivel 3 (secuencial — NUNCA Playwright en paralelo):
   a. `browser_navigate` a la URL
   b. `browser_snapshot` para leer el contenido
   c. Clasificar:
      - **Activa**: título del puesto visible + descripción del rol + botón Apply/Submit/Solicitar
      - **Expirada** (cualquiera de estas señales):
        - URL final contiene `?error=true` (Greenhouse redirige así cuando la oferta está cerrada)
        - Página contiene: "job no longer available" / "no longer open" / "position has been filled" / "this job has expired" / "page not found"
        - Solo navbar y footer visibles, sin contenido JD (contenido < ~300 chars)
   d. Si expirada: registrar en `scan-history.tsv` con status `skipped_expired` y descartar
   e. Si activa: continuar al paso 8

   **No interrumpir el scan entero si una URL falla.** Si `browser_navigate` da error (timeout, 403, etc.), marcar como `skipped_expired` y continuar con la siguiente.

8. **Para cada oferta nueva verificada que pase filtros**:
   a. Añadir a `pipeline.md` sección "Pendientes": `- [ ] {url} | {company} | {title}`
   b. Registrar en `scan-history.tsv`: `{url}\t{date}\t{query_name}\t{title}\t{company}\tadded`

9. **Ofertas filtradas por título**: registrar en `scan-history.tsv` con status `skipped_title`
10. **Ofertas duplicadas**: registrar con status `skipped_dup`
11. **Ofertas expiradas (Nivel 3)**: registrar con status `skipped_expired`

## Extracción de título y empresa de WebSearch results

Los resultados de WebSearch vienen en formato: `"Job Title @ Company"` o `"Job Title | Company"` o `"Job Title — Company"`.

Patrones de extracción por portal:
- **Ashby**: `"Senior AI PM (Remote) @ EverAI"` → title: `Senior AI PM`, company: `EverAI`
- **Greenhouse**: `"AI Engineer at Anthropic"` → title: `AI Engineer`, company: `Anthropic`
- **Lever**: `"Product Manager - AI @ Temporal"` → title: `Product Manager - AI`, company: `Temporal`

Regex genérico: `(.+?)(?:\s*[@|—–-]\s*|\s+at\s+)(.+?)$`

## URLs privadas

Si se encuentra una URL no accesible públicamente:
1. Guardar el JD en `jds/{company}-{role-slug}.md`
2. Añadir a pipeline.md como: `- [ ] local:jds/{company}-{role-slug}.md | {company} | {title}`

## Scan History

`data/scan-history.tsv` trackea TODAS las URLs vistas:

```
url	first_seen	portal	title	company	status
https://...	2026-02-10	Ashby — AI PM	PM AI	Acme	added
https://...	2026-02-10	Greenhouse — SA	Junior Dev	BigCo	skipped_title
https://...	2026-02-10	Ashby — AI PM	SA AI	OldCo	skipped_dup
https://...	2026-02-10	WebSearch — AI PM	PM AI	ClosedCo	skipped_expired
```

## Resumen de salida

```
Portal Scan — {YYYY-MM-DD}
━━━━━━━━━━━━━━━━━━━━━━━━━━
Queries ejecutados: N
Ofertas encontradas: N total
Filtradas por título: N relevantes
Duplicadas: N (ya evaluadas o en pipeline)
Expiradas descartadas: N (links muertos, Nivel 3)
Nuevas añadidas a pipeline.md: N

  + {company} | {title} | {query_name}
  ...

→ Ejecuta /zhicheng pipeline para evaluar las nuevas ofertas.
```

## Gestión de careers_url

Cada empresa en `tracked_companies` debe tener `careers_url` — la URL directa a su página de ofertas. Esto evita buscarlo cada vez.

**Patrones conocidos por plataforma:**
- **Ashby:** `https://jobs.ashbyhq.com/{slug}`
- **Greenhouse:** `https://job-boards.greenhouse.io/{slug}` o `https://job-boards.eu.greenhouse.io/{slug}`
- **Lever:** `https://jobs.lever.co/{slug}`
- **Custom:** La URL propia de la empresa (ej: `https://openai.com/careers`)

**Si `careers_url` no existe** para una empresa:
1. Intentar el patrón de su plataforma conocida
2. Si falla, hacer un WebSearch rápido: `"{company}" careers jobs`
3. Navegar con Playwright para confirmar que funciona
4. **Guardar la URL encontrada en portals.yml** para futuros scans

**Si `careers_url` devuelve 404 o redirect:**
1. Anotar en el resumen de salida
2. Intentar scan_query como fallback
3. Marcar para actualización manual

## Mantenimiento del portals.yml

- **SIEMPRE guardar `careers_url`** cuando se añade una empresa nueva
- Añadir nuevos queries según se descubran portales o roles interesantes
- Desactivar queries con `enabled: false` si generan demasiado ruido
- Ajustar keywords de filtrado según evolucionen los roles target
- Añadir empresas a `tracked_companies` cuando interese seguirlas de cerca
- Verificar `careers_url` periódicamente — las empresas cambian de plataforma ATS
