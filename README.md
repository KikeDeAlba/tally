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
  apoyo y `/tally-pending` y `/tally-push` en el formato de cada uno.

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
| `agents/tally-push.md` | Subagente (Bash y Read) que hace todo el volcado con tally y atl | Trabaja en su propia ventana y devuelve solo la tabla de lo creado |
| `skills/tally-pending` | `/tally-pending`: lo que falta subir, sin escribir nada | Nada hasta que el usuario lo escribe |
| `skills/tally-push` | `/tally-push`: plan del subagente, decisiones y una sola confirmación, y escritura | Nada hasta que el usuario lo escribe |

Jira se toca solo con la CLI de atl. Las reglas de redacción viven en inkwell
(`inkwell guide writing`); la skill guarda solo un resumen mínimo para cuando
inkwell no está. Grabar y consultar reuniones es de recap.

Hace falta Node 24 o superior, y bita instalado (`npm install -g @kikedealba/bita
&& bita setup`).

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

tally map list
tally map set <projectId> <JIRAKEY> --parent <JIRAKEY-123>   # siempre a esa épica
tally map set <projectId> <JIRAKEY> --no-epic                # al tablero: la épica se elige en cada corrida
tally map set <projectId> <JIRAKEY> --site <sitio de atl>    # tablero en otro sitio
tally map story <projectId> <tema> <ISSUE-KEY> [--epic <KEY-123> | --no-epic]
tally map unset <projectId>

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

Los ids de proyecto y de entrada son los de bita (`bita projects`, `bita
entries`).

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
  horas partió el título), `meetings[]` (solo reuniones), `docs[]` (`entryId`,
  `path`, `sections`, `markdown`, y `truncated`/`missing` cuando aplican) y
  `pages[]` (`pageId`, `title`, `issues`).
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

## Eventos de bita

`tally setup` suscribe tally a los eventos `delete` y `merge` de bita (por el
registro de kit, comando `tally bita-hook`):

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
| Mapeos, proyectos fuera de Jira, temas y datos de Jira | `~/.config/tally/config.json` (Windows: `%APPDATA%\tally\config.json`) | `TALLY_CONFIG_PATH` |

`XDG_DATA_HOME` y `XDG_CONFIG_HOME` se respetan.

## Capacidades

`tally capabilities --json` anuncia `timesheet.summary`, `timesheet.map` y
`timesheet.link`. Cualquier herramienta puede encontrar tally con kit
(`findTool('tally', { capability: 'timesheet.summary' })`) y llamarlo con
`--json`; la pestaña Jira de Den usa `tally summary --pending --json`, la forma completa.

## Desarrollo

```sh
pnpm install
pnpm typecheck
pnpm test
node src/bin/tally.ts help
```

## Licencia

MIT
