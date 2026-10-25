# tally

Agrupa en tareas listas para Jira el tiempo que mide [bita](https://github.com/KikeDeAlba/bita-cli)
y lleva la cuenta de qué entradas ya se registraron.

- **bita** mide: cronómetros, entradas y proyectos.
- **tally** agrupa: proyecto + título → una tarea, con un worklog por bloque, la
  estimación redondeada al medio punto y el tope de 8 horas por tarea. Guarda a
  qué tablero, épica e Historias va cada proyecto, y qué entradas ya están en
  Jira.
- **[atl](https://github.com/KikeDeAlba/atl)** escribe en Jira. Lo hace el agente
  siguiendo la skill de tally; tally solo anota el resultado con `tally link`.
- **[inkwell](https://github.com/KikeDeAlba/inkwell)**, si está instalado, aporta
  la nota y las páginas de cada entrada.

Ninguna herramienta depende de otra: se encuentran por el registro de
[kit](https://github.com/KikeDeAlba/kit) y hablan por su CLI con `--json`.

## Instalación

```sh
npm install -g @kikedealba/tally
tally setup
```

`tally setup` se registra en kit y conecta tally con los agentes que encuentre
(`--agents claude,codex` elige cuáles, `--agents all` los fuerza todos y
`--no-agents` solo registra):

- **Claude Code** recibe el plugin `tally` de este repositorio, que es su propio
  marketplace: `claude plugin marketplace add KikeDeAlba/tally` y `claude plugin
  install tally@tally --scope user` (o `update`, si ya estaba). Los archivos
  sueltos que dejaba tally 0.1 en `~/.claude` (skill y comandos enlazados) se
  quitan, y se conservan los permisos de `tally summary`, `tally link` y
  compañía. Para que el cambio surta efecto hay que reiniciar Claude Code.
- **OpenCode, Codex y Gemini CLI** reciben la skill `tally` con sus archivos de
  apoyo, `/tally-pending` y `/tally-push` en el formato de cada uno y el
  subagente `tally-push`.
- **Antigravity CLI** (`agy`) recibe un plugin con la skill `tally`, el
  subagente `tally-push` y una regla `always_on` corta que lleva a la skill;
  `agy` no tiene comandos, así que `/tally-pending` y `/tally-push` se piden
  con palabras.
- **Claude Desktop** no recibe nada: tally no tiene servidor MCP, y el paso
  sale como `skipped`.

`--agents` acepta `claude`, `opencode`, `codex`, `gemini`, `antigravity` y
`claude-desktop` (los nombres de `agents.AGENTS` de kit), separados por comas.

### El plugin de Claude Code

Sin `tally setup`, el plugin se instala desde Claude Code (2.1.275 o posterior)
con:

```
/plugin install tally --marketplace KikeDeAlba/tally
```

| Pieza | Qué es | Cuándo cuesta contexto |
|---|---|---|
| `skills/tally/SKILL.md` | La skill: cuándo usarla, el flujo en breve y las reglas duras | Su descripción, siempre; el cuerpo (menos de 150 líneas), al usarla |
| `skills/tally/procedure.md` | El procedimiento completo del volcado | Solo cuando se lee para escribir en Jira |
| `skills/tally/meetings.md` | Lo que cambia en los grupos de reunión | Solo si hay reuniones |
| `agents/tally-push.md` | Subagente (terminal, leer y escribir archivos) que hace todo el volcado con tally y atl | Trabaja en su propia ventana y devuelve solo la tabla de lo creado |
| `skills/tally-pending` | `/tally-pending`: lo que falta subir, sin escribir nada | Nada hasta que el usuario lo escribe |
| `skills/tally-push` | `/tally-push`: plan del subagente, decisiones y una sola confirmación, y escritura | Nada hasta que el usuario lo escribe |

Jira se toca solo con la CLI de atl. Las reglas de redacción viven en inkwell
(`inkwell guide writing`); la skill guarda solo un resumen mínimo para cuando
inkwell no está. Grabar y consultar reuniones es de recap.

Hace falta Node 24 o superior, y bita instalado (`npm install -g @kikedealba/bita`
y luego `bita setup`).

### Si venías de bita 0.x

Hasta bita 0.18 el registro de lo subido y los mapeos vivían en bita. Para
traerlos:

```sh
tally migrate --from-bita --dry-run
tally migrate --from-bita
```

Copia las filas de `jira_links` de `bita.db`, y de `~/.config/bita/config.json`
los mapeos de proyecto (con su caché de Historias por épica), los temas, el tipo
de issue por defecto, los datos de Jira y la zona horaria. El sitio de Atlassian
de cada proyecto pasa a su mapeo, y los proyectos que bita tenía fuera de Jira
quedan así en tally (`tally project jira`). Se puede correr las veces que haga falta: lo
que tally ya tiene se respeta y solo se rellenan los huecos. **bita no se
modifica.** `BITA_DB_PATH` y `BITA_CONFIG_PATH` apuntan a otros archivos.

## Uso

```sh
tally summary --pending                      # lo que falta subir, agrupado
tally summary week --json                    # la semana, en el envelope de kit
tally summary --from 2026-10-01 --to 2026-10-09
tally groups --pending --json                # alias de summary
tally status month                           # subido, pendiente, excluido y fuera de Jira por proyecto
tally status --last-days 30 --project 789 --entries --json
tally overtime --month 2026-10 --salary-file "<ruta>"  # horas extra del mes (sueldo en un borrador)

tally map list
tally map set <projectId> <JIRAKEY> --parent <JIRAKEY-123>   # siempre a esa épica
tally map set <projectId> <JIRAKEY> --no-epic                # al tablero: la épica se elige en cada corrida
tally map set <projectId> <JIRAKEY> --site <sitio de atl>    # tablero en otro sitio
tally map story <projectId> <tema> <ISSUE-KEY> [--epic <KEY-123> | --no-epic]
tally map board <projectId> <boardId>        # tablero del que sale el sprint activo
tally map auto <projectId> on|off            # abrir la tarjeta al arrancar cada cronómetro del proyecto
tally map unset <projectId>

tally issue open 12 --json                   # tarjeta de Jira para la entrada 12 de bita
tally issue open 12 --jira-project PP        # a otro proyecto de Jira (o uno sin mapeo)
tally issue fill 12 --description "@<ruta>"  # texto del agente, en un borrador de tally paths --draft
tally issue fill 12                          # texto automático: nota, archivos y commits
tally issue show 12 --json                   # su tarjeta, o null (no toca Jira)
tally issue pending                          # entradas que esperan que elijas proyecto

tally link 12 13 --issue DD-1896             # marca como registradas
tally link 12 --issue DD-1896 --worklog 10042
tally link 12 13 --unlink                    # vuelven a pendientes

tally project jira "Can Doo" off             # su tiempo nunca va a Jira
tally project jira CDP                       # consulta
```

`tally map list --json` da una fila por proyecto, con mapeo o sin él (los de bita
y los que tally tiene marcados), y cada fila lleva `jira: true|false`.

```sh
tally config get
tally config set-jira --account-id <id> --atl-site <sitio> --issue-type Tarea
```

```sh
tally paths                 # base, config, skill, borradores y archivos de bita
tally paths --draft desc    # ruta nueva para un borrador en markdown
```

`tally paths --draft <nombre>` crea la carpeta de borradores (en la temporal del
sistema, solo del usuario; `TALLY_DRAFTS_DIR` la cambia) e imprime una ruta nueva
`<nombre>-<aleatorio>.md`. El agente escribe ahí el markdown con su herramienta
de archivos y lo pasa como `"@<ruta>"`, entre comillas para que PowerShell no lo
tome como splatting. Así no hacen falta heredocs ni `/tmp`, y funciona igual en
bash, PowerShell y cmd. Los borradores de más de un día se borran solos. En Claude Code,
`tally setup` agrega a los permisos un `Edit(//<carpeta de borradores>/**)` para
que el agente y el subagente `tally-push` los escriban sin preguntar.
`--salary-file` solo acepta un borrador de esa carpeta (nunca un enlace
simbólico ni otra ruta) y lo borra en cuanto lo lee, antes de todo lo demás.

Los ids de proyecto y de entrada son los de bita (`bita projects`, `bita
entries`).

### `issue`: la tarjeta de Jira ligada al cronómetro

Es la única escritura en Jira que hace tally por su cuenta (con la CLI de atl);
el resto lo escribe el agente.

`tally issue open <entryId>` lee la entrada de bita y el mapeo de su proyecto y
crea el issue de trabajo: Subtarea bajo la Historia del tema (`soporte`, o
`sesiones` si es reunión; si no está en caché, la primera cacheada; sin
ninguna, `NEEDS_STORY` con las opciones, y se reintenta con `--story KEY`), o
Tarea suelta con `flat-task`. Título: el de la entrada, o `[WIP] <día>` si aún
no tiene. Va asignado (`jira.accountId` o `atl jira myself`), con fecha de
inicio (`customfield_10015`, o `jira.startDateField` de la config), su Historia
(o la Tarea) al sprint activo del tablero (si el proyecto no tiene `boardId` y
hay un solo tablero, se guarda; sin tablero o sin sprint activo, se queda en el
backlog con un aviso) y pasa a un estado «en curso» si la transición existe.
Sin mapeo ni `--jira-project`, falla con `NEEDS_PROJECT` y `data.options`: los
proyectos de Jira mapeados, el más usado recientemente primero. Es idempotente:
si la entrada ya tiene tarjeta, la devuelve.

La tarjeta queda en `registrations` con `source = 'timer'` y sin worklog, así
que la entrada **sigue pendiente** en `summary --pending`; su grupo trae
`issueKey` y `/tally-push` sube el worklog a esa tarjeta en vez de crear otra.
`tally link` con el worklog la deja registrada como cualquier otra.

`tally issue fill <entryId>` escribe el texto. Con `--summary` o
`--description` (texto o `@archivo`) es el texto del agente y siempre se
escribe. Sin texto arma uno determinista con la nota de inkwell, los archivos
que tocó la entrada y los commits de los repositorios del proyecto entre el
inicio y el fin; nunca pisa un texto del agente.

### `summary`

Pide las entradas a bita (`bita entries … --json`), marca como registradas las
que tally tiene atadas a un issue, y las agrupa por proyecto y título. La forma
de `data` es la misma que tenía `bita summary`:

- `data.groups[]`: `summary`, `totalSeconds`/`totalHuman`,
  `estimateSeconds`/`estimateHuman`, `worklogs[]` (`startedJira`, `timeSpent`,
  `entryId`), `entryIds[]`, `days[]`, `partIndex`/`partCount`, `kind` y
  `meeting(s)`, el destino en Jira (`jiraProjectKey`, `epicMode`,
  `jiraEpicKey`, `jiraStories`, `jiraStoriesByEpic`, `jiraSite`, tipos de
  issue), y `docs[]`/`pages[]`/`noteCoverage` cuando inkwell está instalado.
- `meta`: `range`, `filter`, `excluded` (corriendo, sin título, sin duración),
  `alreadyRegistered`, `overlaps`, `unmappedProjects`, `nonJira`,
  `storyThemes`, `notes` y `warnings`.

Opciones: un preset (`today`, `yesterday`, `week`, `last-week`, `month`,
`last-month`) o `--from`/`--to`/`--last-days`; `--pending` o `--registered`;
`--include-running`; `--case-insensitive`; `--max-task-hours N` (8 por
defecto); `--estimate-step-minutes N` (30 por defecto); `--no-notes`;
`--notes-mode inline|path|both`; `--notes-budget-kb N`; `--brief`. Sin rango,
`--pending` mira los últimos 90 días.

### `summary --brief`

La forma compacta, la que piden siempre la skill y el subagente. Con `--json`:

- `data.groups[]`: `summary`, `projectId`, `jira`, `kind`, `totalHuman`,
  `estimateHuman`, `days`, `entryIds`, `worklogs[]` (`entryId`, `startedJira`,
  `startLocal`, `timeSpent`), `part` (`index`, `count`, solo si el tope de 8
  horas partió el título), `meetings[]` (solo reuniones; `kind` `meeting`,
  `remote-meeting` o `in-person-meeting`, y `mode` `meeting`, `remote` o
  `in-person`), `docs[]` (`entryId`, `path`, `sections`, `markdown`, y
  `truncated`/`missing` cuando aplican) y `pages[]` (`pageId`, `title`,
  `issues`).
- `data.projects[projectId]`: el destino en Jira una sola vez por proyecto en
  lugar de repetirlo en cada grupo (`jiraProjectKey`, `jiraSite`, `epicMode`,
  `hierarchy`, `jiraEpicKey`, `epicResolved`, `jiraStories`, los tipos de
  issue, y `jiraStoriesByEpic` solo en los proyectos `per-run`).
- `data.totalHuman`, `jiraHuman`, `nonJiraHuman`.
- `meta`: `range`, `groupCount`, `entryCount`, `excluded` (con `reason`),
  `alreadyRegistered` (conteo), `overlaps`, `unmappedProjects`, `nonJira`
  (`totalHuman` y proyectos), `conflicts`, `notes` (`provider`, `missing`,
  `truncatedEntryIds`) y `warnings`.

Fuera quedan `storyThemes` y los datos de Jira de la configuración (los da
`tally config get --json`), el filtro, los segundos y horas en número, y los
campos de cada grupo que el volcado no usa. Sin `--json`, la tabla es la misma
de siempre.

Una entrada unificada con `bita merge` da un worklog por cada bloque original,
cada uno con su id en `entryIds`. Cada bloque se registra por su propio id, así
que `tally link` recibe todos los `entryIds` del grupo.

### `status`

El balance de un rango por proyecto, sin agrupar y sin leer notas de inkwell.
Toma las entradas de bita, separa los bloques de las unificadas como `summary`
(cada uno con su día y su duración) y cruza los registros de tally y los
proyectos fuera de Jira. Cada segundo cae en una sola columna:

- `registeredSeconds`: atado a un issue con `tally link`, aunque después el
  proyecto haya salido de Jira.
- `pendingSeconds`: lo que `summary --pending` propondría subir.
- `excludedSeconds`: lo que `summary` excluye (corriendo, título de menos de 3
  letras, menos de un minuto). Un cronómetro que sigue corriendo cae aquí,
  también fuera de Jira, salvo con `--include-running`.
- `nonJiraSeconds`: lo no registrado de proyectos fuera de Jira (`tally
  project jira … off`).

Aparte de las cuatro columnas va `estimateSeconds`: la estimación que `summary`
daría a lo registrado y pendiente del rango, sin lo que `summary` excluye
(tampoco lo registrado). Agrupa igual, por proyecto y título con las opciones
por defecto (tope de 8 horas, sin `--case-insensitive`), redondea cada grupo
hacia arriba al paso de estimación y vale 0 en los proyectos fuera de Jira.
Como cada grupo se redondea dentro del rango pedido, el de un mes no es la suma
de sus semanas. Es la cifra que usa Den para las horas
extra.

Con `--json`, `data.projects[]` (`projectId`, `name`, `jira`, las cuatro
columnas y `estimateSeconds`, de mayor a menor), `data.totals` con las mismas
cinco, y con
`--entries` también `data.entries[]` (`entryId`, `registered`, `issueKey`,
`jira`, `excludedReason`, `projectId`, `localDay`, `seconds`). `meta` trae
`range`, `projectId`, `entryCount`, `runningSeconds` (lo que sigue corriendo),
`includeRunning`, `estimateStepMinutes` y `warnings` (corriendo, solapes, conflictos de merge y la
migración pendiente, como `summary`).

Opciones: el rango igual que `summary` (preset, `--from`/`--to`,
`--last-days`, `--timezone`), `--project <id|clave|nombre>`, `--entries`,
`--include-running` (cuenta lo que sigue corriendo en su columna, hasta ahora)
y `--estimate-step-minutes N` (30 por defecto, como `summary`).

### `overtime`

Horas extra por mes, para ti o para un compañero, con la misma fórmula:

- hora = sueldo ÷ horas del mes (`--monthly-hours`, 160 por defecto);
- extra = max(0, estimación del mes − horas del mes), mes por mes;
- pago ×1 = horas extra × hora; pago ×N = pago ×1 × `--multiplier` (2).

El sueldo se da en cada consulta y nunca se guarda ni se escribe en logs:
`--salary-file <ruta>` lo lee de un archivo y lo borra (es lo que usa la skill:
el agente escribe la cifra con su herramienta de archivos en la ruta de `tally
paths --draft salary`, sin shell de por medio), `--salary-stdin` lo lee de la
entrada estándar (lo que usa Den) o `--salary N`. Los dos primeros no dejan el
sueldo en la lista de procesos. Sin sueldo salen solo
las horas y los montos van en `null`. Los meses: `--month YYYY-MM` (por defecto
el actual) o `--from YYYY-MM [--to YYYY-MM]`.

**Tú** (sin `--user`): la estimación de `status` de cada mes calendario, solo de
proyectos que van a Jira, sin los que pases con `--exclude <proyecto de bita>`
(repetible). Acepta `--include-running` y `--timezone`.

**Un compañero** (`--user "<nombre>"` o `--account-id <id>`): se lee de Jira por
la CLI de atl (`atl api call … --json`, solo lectura), en el sitio de
`--site` o el de `tally config set-jira --atl-site`:

- La persona se busca por nombre o correo. Gana el nombre exacto; si no, la
  única persona activa cuyo nombre o correo contiene todas las palabras de la
  búsqueda (sin acentos, como palabra o inicio de palabra). Si hay varias, falla con
  `USER_AMBIGUOUS` y `data.candidates[]` (`displayName`, `email` si es visible,
  `accountId`) para repetir con `--account-id`; si no hay ninguna,
  `USER_NOT_FOUND`.
- Cuentan sus issues **asignados** y **terminados** (`statusCategory = Done`),
  ubicados en el mes por su **fecha de inicio**, sumando la **estimación
  original**. Los que no tienen estimación van aparte en `withoutEstimate` y no
  suman.
- El campo de fecha de inicio ("Fecha de inicio" o "Start date") se busca una
  vez por sitio y queda en la config de tally cuando el sitio tiene nombre
  (`--site` o `--atl-site`; con el sitio por defecto de atl se busca en cada
  consulta); `--start-field customfield_N` lo fuerza.
- Una lista común de proyectos de Jira que nunca cuentan, para todos los
  compañeros: `tally overtime exclude add PP`, `exclude rm PP`, `exclude ls`.

Con `--json`: `data.person` (`name`, `accountId`, `source`: `timers` o `jira`),
`data.rate` (`hourlyRate`, `monthlyHours`, `multiplier`, `currency`),
`data.months[]` (`month`, `estimateSeconds`, `expectedSeconds`,
`overtimeSeconds`, `payX1`, `payMultiplied`, `issues[]` y `withoutEstimate[]`
con `key`, `summary`, `project`, `status`, `startDate`, `estimateSeconds` y
`url`) y `data.totals`. Para un compañero, `meta` trae el sitio, `siteUrl`, el
campo de fecha de inicio, los proyectos excluidos y el JQL de cada mes. `url` es
`<siteUrl>/browse/<KEY>`, con la URL del sitio que da `atl site ls --json` (el de
`--site` o el por defecto de atl); si atl no conoce el sitio, `url` y `siteUrl`
van en `null`. En texto, las claves son enlaces clicables (OSC 8) solo en una
terminal interactiva, sin `NO_COLOR` ni `TERM=dumb`.

```sh
tally overtime --month 2026-10 --salary-file "<ruta de tally paths --draft salary>" --json
tally overtime --user "Ana" --from 2026-08 --to 2026-10
tally overtime exclude add PP
```

## Eventos de bita

`tally setup` suscribe tally a los eventos `start`, `stop`, `delete` y `merge`
de bita (por el registro de kit, comando `tally bita-hook`):

- **start**: si el proyecto tiene `tally map auto <id> on`, o el cronómetro se
  arrancó con `bita start --jira`, abre la tarjeta (`tally issue open`). Con
  `--no-jira` nunca. Si falta elegir proyecto o Historia, la entrada queda en
  `tally issue pending` y llega una notificación del sistema (macOS, Linux con
  `notify-send` o Windows; `TALLY_NO_NOTIFY=1` la apaga).
- **stop**: si la entrada tiene tarjeta abierta por el cronómetro, la rellena
  sin texto (`tally issue fill`), salvo que el agente ya la haya escrito.

- **delete**: el registro de la entrada borrada (y de sus bloques) se conserva
  como huérfano, para no perder la historia, y deja de contar: un id que bita
  reutilice nace pendiente.
- **merge**: cada bloque conserva su propio registro, así que lo ya subido no
  vuelve a salir en `--pending` y lo que no se había subido sí. Se anota qué
  entrada absorbió a cuál, y si los bloques quedan en issues distintos o en
  parte registrados, `summary` lo reporta en `meta.conflicts` y en un aviso.

## Datos

| Qué | Dónde | Variable |
|---|---|---|
| Registros (entrada ↔ issue, worklog, fecha) | `~/.local/share/tally/tally.db` (Windows: `%LOCALAPPDATA%\tally\tally.db`) | `TALLY_DB_PATH` |
| Mapeos, proyectos fuera de Jira, temas, datos de Jira y excluidos de horas extra | `~/.config/tally/config.json` (Windows: `%APPDATA%\tally\config.json`) | `TALLY_CONFIG_PATH` |

`XDG_DATA_HOME` y `XDG_CONFIG_HOME` se respetan.

Los archivos de bita que lee `tally migrate --from-bita` salen de las carpetas de
kit para bita: `${XDG_DATA_HOME:-~/.local/share}/bita/bita.db` y
`~/.config/bita/config.json` (Windows: `%LOCALAPPDATA%\bita\bita.db` y
`%APPDATA%\bita\config.json`). Si ahí no hay nada se usa la otra ruta conocida
(`~/.local/share/bita` en Windows, `${XDG_CONFIG_HOME}/bita` en unix).
`BITA_DB_PATH` y `BITA_CONFIG_PATH` mandan sobre todo.

## Capacidades

`tally capabilities --json` anuncia `timesheet.summary`, `timesheet.status`,
`timesheet.map`, `timesheet.link`, `timesheet.overtime`, `timesheet.issue` y
`timesheet.meeting-kind`. Con `timesheet.meeting-kind` tally trata como
reunión el tipo `meeting` de bita, además de `remote-meeting` e
`in-person-meeting`. Cualquier herramienta puede encontrar tally con kit
(`findTool('tally', { capability: 'timesheet.summary' })`) y llamarlo con
`--json`; la pestaña Jira de Den usa `tally summary --pending --json`, la forma completa,
y la ventana de reportes, `tally status --json`.

## Desarrollo

```sh
pnpm install
pnpm typecheck
pnpm test
node src/bin/tally.ts help
```

## Licencia

MIT
