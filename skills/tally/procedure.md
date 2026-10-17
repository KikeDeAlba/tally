# Volcado a Jira: procedimiento completo

Se lee cuando hay que escribir en Jira. Las reglas duras de `SKILL.md` valen en
todo momento. Jira se toca solo con la CLI de atl, siempre con `--json` y con
`--site <jiraSite>` cuando el proyecto lo trae distinto de `null`. Las
descripciones y los comentarios van en markdown (atl los convierte a ADF); los
textos largos se pasan con `@archivo.md`. Sin herramienta de escritura, el
archivo se crea con un heredoc entrecomillado, que no expande `$` ni comillas
invertidas: `cat > /tmp/tally-desc.md <<'MD'` … `MD`.

## Comandos de atl

| Paso | CLI |
|---|---|
| Cuenta | `atl jira myself --json` (`data.accountId`) |
| Buscar tablero | `atl jira project ls [texto] --json` |
| Leer issue | `atl jira issue get <KEY> --json` |
| Tipos del proyecto | `atl jira createmeta <PROYECTO> --json` |
| Campos de un tipo | `atl jira createmeta <PROYECTO> <tipo> --json` |
| Crear | `atl jira issue create --project <KEY> --type <tipo> --summary "<título>" --description @desc.md [--parent <KEY>] [--assignee <accountId>] [--estimate "2h 30m"] [--fields '{"customfield_10015":"2026-10-06"}'] --json` |
| Editar | `atl jira issue edit <KEY> [--estimate "2h"] [--fields '{…}'] --json` |
| Worklog | `atl jira worklog add <KEY> --started <startedJira> --time-spent "<timeSpent>" --comment "<texto>" --json` |
| Comentario | `atl jira comment add <KEY> --body @resultado.md --json` |
| Transiciones | `atl jira issue transitions <KEY> --json` |
| Transicionar | `atl jira issue transition <KEY> <id> --json` |
| JQL | `atl jira search "<JQL>" --fields <campos> [--limit n] --json` (sin `--fields` trae solo key, summary, status y assignee; pide exactamente lo que hace falta) |
| Adjuntar | `atl jira attach <KEY> <archivo> --json` |
| Tableros | `atl jira board ls <PROYECTO> --fields id,name,type --json` |
| Sprint activo | `atl jira sprint ls <boardId> --state active --json` |
| Meter al sprint | `atl jira sprint add <sprintId> --issues <KEY>[,<KEY>] --json` |

## La forma de `tally summary --pending --brief --json`

`data.groups[]`, una tarea de Jira por elemento:

- `summary`: el título tal cual; va literal al issue.
- `projectId`, `jira`, `kind` (`null`, o el tipo de entrada; las reuniones
  traen además `meetings[]` con `entryId`, `startedAt`, `durationSeconds`,
  `mode`).
- `totalHuman`: lo medido, que suman los worklogs. `estimateHuman`: la
  estimación original, redondeada hacia arriba al medio punto.
- `days[]`, `entryIds[]` (para `tally link`), `worklogs[]` (`entryId`,
  `startedJira`, `startLocal`, `timeSpent`): un worklog por bloque, también los
  bloques de una entrada unificada con `bita merge`.
- `part` (`index`, `count`): solo si el tope de 8 horas partió el título.
- `issueKey`: solo si el grupo ya tiene tarjeta, abierta al arrancar el
  cronómetro (`tally issue open`). No se crea otra: ver el paso 7.
- `docs[]` (`entryId`, `path`, `sections`, `markdown`; `truncated` si no cupo:
  léelo de `path`) y `pages[]` (`pageId`, `title`, `issues`), de inkwell.

`data.projects[projectId]`, el destino de cada proyecto con mapeo:
`jiraProjectKey` (`null` si falta mapear), `jiraSite`, `epicMode` (`fixed`,
`per-run`, `flat`), `hierarchy`, `jiraEpicKey`, `epicResolved`, y las
Historias ya conocidas: `jiraStories` (tema → Historia bajo la épica fija) o,
en los `per-run`, `jiraStoriesByEpic` (épica → tema → Historia; `""` es sin
épica),
`jiraStoryIssueTypeName`, `jiraWorkIssueTypeName`, `jiraIssueTypeName`.

`meta`: `range`, `excluded` (con `reason`), `alreadyRegistered` (conteo),
`overlaps`, `unmappedProjects`, `nonJira`, `conflicts`, `notes` y `warnings`.

## 0. Verificar

`tally config get --json` y `atl jira myself --json`. Guarda el `accountId`: va
en `--assignee` de cada issue de trabajo. Si la config no lo tiene, `tally
config set-jira --account-id <id>`. Confirma una vez por corrida el id del campo
«Fecha de inicio» con `atl jira createmeta <PROYECTO> <tipo de trabajo> --json`
(en este tenant, `customfield_10015`).

## 1. Alcance

Sin rango: todo lo pendiente, con tope de 90 días (tally lo avisa). Con rango:
preset, `--from`/`--to` o `--last-days N`. Confírmalo en una línea.

## 2. Triaje

Nada de esto se escribe en Jira, pero todo se reporta:

| Caso | Qué hacer |
|---|---|
| `running` | Excluir, decir cuáles (`bita ls`) y ofrecer pararlos. |
| `no-description` | No inventar título: pedirlo o dejarlas pendientes. |
| `zero-duration` | Excluir: Jira rechaza worklogs de menos de un minuto. |
| `meta.conflicts` | Bloques de una entrada unificada ya registrados en otro issue: decir los issues y bloques, y que el usuario elija si lo pendiente va al mismo issue o a uno nuevo. |
| `meta.overlaps` | Cronómetros solapados: permitido; decir las horas exactas. |
| `part` | Varias tareas para un título por el tope de 8 horas: decirlo. |
| `meta.nonJira` | Una línea aparte («Fuera de Jira: 3h 30m de X»). |
| Sin proyecto | No inventar destino: `bita amend <id> --project <X>` o dejarlas. |

## 3. Mapeos faltantes, en un solo bloque

Por cada proyecto de `meta.unmappedProjects`, pide la clave del tablero y
valídala con `atl jira project ls <texto> --json` (máximo 8 candidatos). Antes
de usar un padre, léelo con `atl jira issue get`: nivel 1 es Épica (admite
Historias o Tareas); nivel 0 es Historia o Tarea y solo admite Subtareas.

```
tally map set <projectId> <KEY> --parent <EPIC-123>
tally map set <projectId> <KEY> --no-epic
tally map set <projectId> <KEY> --site <sitio de atl>
```

`--no-epic` marca `epicResolved: true` y deja el proyecto `per-run`: no se
vuelve a preguntar. Un proyecto con `epicResolved: false` y sin épica se
pregunta en este mismo bloque. Los ya mapeados no se preguntan nunca. Si el
usuario cancela a mitad, se aborta la corrida.

## 4. Jerarquía, épica e Historia

En este tenant: Épica = 1; Historia, Tarea, Error = 0; Subtarea = −1. Una
Historia no puede contener Tareas, solo Subtareas.

| `hierarchy` | Qué se crea |
|---|---|
| `epic-story-subtask` | Historia bajo la épica; Subtareas bajo la Historia |
| `story-subtask` | Historia suelta; Subtareas bajo ella |
| `flat-task` | Tarea suelta (solo si el usuario lo pidió) |

**Épica, solo con `per-run`.** Una vez por tablero:
`project = <KEY> AND issuetype = Epic AND statusCategory != Done ORDER BY updated DESC`
(con la forma compacta basta: key y summary).
Elige por grupo con página, título, repo y rama (la épica es el frente de
trabajo, no el tipo). Si ninguna encaja, Historia suelta; si hace falta un
frente nuevo, propón la épica por nombre. Enseña la épica elegida en la
propuesta.

**Tema canónico.** Las Historias se llaman como un tema de la lista: DevOps ·
Backend · Frontend · Infraestructura · Análisis y estimación · Seguridad ·
Soporte · Sesiones y reuniones · Documentación (si la config trae
`defaults.storyThemes`, esa lista manda). Las claves son `devops`, `backend`,
`frontend`, `infra`, `analisis`, `seguridad`, `soporte`, `sesiones`, `docs`.
La señal más fuerte es el documento del grupo, luego título, repo y rama. Si no
encaja ninguno, pregunta; no inventes temas.

**Historia.** Si `jiraStories[tema]` (o, en `per-run`,
`jiraStoriesByEpic[<épica elegida>][tema]`) ya tiene key, úsala. Si no, busca y empata por igualdad exacta normalizada (sin
acentos, espacios ni mayúsculas), nunca con `summary ~`:
`project = <KEY> AND issuetype = Historia AND parent = <épica> ORDER BY created DESC`,
con `--fields summary,parent,issuetype`.
Sin épica, añade `AND parent IS EMPTY AND reporter = currentUser()`. Si no hay
empate, propón crearla; al crearla (sin asignar, sin estimación), persístela de
inmediato con `tally map story <projectId> <tema> <KEY>` (con `per-run`,
`--epic <EPIC-123>` o `--no-epic`).

## 5. Preflight por proyecto y tipo

`atl jira createmeta <PROYECTO> --json`: los tipos están en español («Tarea»,
«Historia», «Subtarea», «Epic»); nunca asumas «Task». Con el tipo: si
`timetracking` está en la pantalla y qué campos son obligatorios.

**Sprint activo**, una vez por tablero. El tablero es `jiraBoardId`; si viene
`null`, `atl jira board ls <PROYECTO>`: con uno solo, ese es; con varios, es
una decisión pendiente (no se adivina). En cuanto se escribe, el tablero queda
con `tally map board <projectId> <boardId>` y no se vuelve a buscar. Luego `atl jira sprint ls
<boardId> --state active`: con uno, ese es el sprint; con varios, decisión
pendiente; sin ninguno (o si el tablero no admite sprints), las tareas quedan
en el backlog y se dice en la propuesta.

Aviso de duplicados antes de crear (avisa, no decide):
`project = X AND summary ~ "..." AND reporter = currentUser() AND created >= -30d`,
con `--fields summary,parent,created --limit 10`.

## 6. Propuesta y confirmación

Una tabla, una fila por tarea: proyecto → Jira, tipo, épica e Historia (marca
lo que se crea; con `issueKey`, la tarjeta existente), sprint, resumen, worklogs, días, total y estimación. Debajo: excluido,
solapes, conflictos, partes y fuera de Jira. Las tareas se cierran al terminar
salvo que el usuario pida lo contrario. La confirmación va por la interfaz de
preguntas con cuatro opciones: Confirmar y escribir · Ajustar · Ver el detalle
· Cancelar. Si la petición era solo de consulta, se termina aquí.

## 7. Escribir, grupo por grupo

Sin paralelismo y sin volver a preguntar. Para reuniones, ver `meetings.md`.

**Grupos con `issueKey`.** La tarjeta ya existe (asignada, fechada, en el
sprint y en curso): se saltan los pasos 1 a 3 y se va directo a estimar (paso
4, siempre con `atl jira issue edit`), worklogs, comentario, cierre y `tally
link` con esa key. Si la tarjeta aún dice `[WIP]` o el texto automático, se
reescriben título y descripción con `tally issue fill <entryId> --summary
"<summary>" --description @desc.md --json` antes del worklog.

1. Si el plan crea épica o Historia, primero eso (sin asignar ni estimar).
2. **Crear** el issue de trabajo: tipo `jiraWorkIssueTypeName` («Subtarea»)
   con `--parent <Historia>`; con `flat`, `jiraIssueTypeName` («Tarea») sin
   padre. `--summary` literal. `--assignee <accountId>` siempre.
   `--fields '{"customfield_10015":"<days[0]>"}'` siempre. `--estimate
   <estimateHuman>` si la pantalla trae `timetracking`.
   La descripción es el **requerimiento**, no el informe:

   ```
   ## Objetivo
   Qué se necesita y por qué.

   ## Alcance
   - Lo que entra (servicio, ambiente, componente).

   ## Criterios de aceptación
   1. Condición verificable
   ```

   Sale del título, de `pages[]` (`inkwell page show <pageId> --json`) y de
   `docs[]`, reformulado como necesidad. Criterios numerados, nunca `- [ ]`.
   Las secciones «Hallazgos» y «Pendiente» de una nota van a `inkwell backlog
   add`, no a Jira.
3. **Sprint activo**, si el tablero tiene uno: `atl jira sprint add <sprintId>
   --issues <KEY>`. Una Subtarea no entra sola a un sprint (va con su padre),
   así que con `epic-story-subtask` y `story-subtask` lo que se mete es la
   Historia del grupo; con `flat`, la Tarea. Una vez por issue y corrida,
   aunque ya esté en ese sprint (no hace daño). La épica nunca.
4. Si no había `timetracking` en la creación: `atl jira issue edit <KEY>
   --estimate <estimateHuman> --fields
   '{"timetracking":{"originalEstimate":"<estimateHuman>","remainingEstimate":"0m"}}'`,
   antes del worklog. Si tampoco la acepta, sigue y avísalo una vez por
   proyecto.
5. **Un worklog por cada `worklogs[]`**, con `startedJira` y `timeSpent`
   literales y comentario `bita · <startLocal> · bita:<entryId>`. Guarda los
   ids.
6. **Comentario de resultados**, uno por issue:

   ```
   ## Resultado
   Qué existe ahora, con nombres concretos (recurso, versión, endpoint, MR).

   ## Verificación
   Un criterio por viñeta, en el orden de la descripción, con lo que dio.

   ## Referencias
   - [Título](https://…) — toda referencia con su enlace.
   ```

   Las URLs salen de las referencias de la página; lo que no tiene URL
   confirmable no se cita. Lo que no quedó hecho va al backlog de inkwell.
7. **Cerrar** (ver abajo), salvo que el usuario pidiera dejarlas abiertas.
8. **`tally link <entryIds...> --issue <KEY> --json`**, una llamada con todos
   los `entryIds` (añade `--worklog <id>` repetido si hubo uno por entrada).
9. `inkwell page link <pageId> --issue <KEY> --summary "<summary>" --status
   "<estado>" --status-category <categoría>`, una por página de `pages[]`.

### Transición de cierre

1. Filtra `to.statusCategory.key === "done"`. Si queda una, úsala.
2. Si quedan varias, elige por `to.name` (nunca por el nombre de la
   transición): Finalizada, Finalizado, Cerrada, Cerrado, Hecho, Completada,
   Terminado, Done. Descarta Cancelado/a, Duplicado, No se hará, Rechazado,
   READY TO TEST. En VBGLOBAL «Listo» lleva a «Cancelado»: el cierre real es
   «Closed» → «Cerrada». Si siguen varias, pregunta.
3. Si ninguna es `done`, un salto a `indeterminate` y vuelve a consultar;
   máximo dos saltos.
4. Si pide campos obligatorios, rellena `resolution` solo con un candidato
   evidente; si no, deja el issue abierto y repórtalo.
5. Transiciona por **id**.

## Fallos

| Falla en | Qué hacer |
|---|---|
| Crear | Nada escrito: reintentar es seguro. |
| Estimación | Continuar y avisar. |
| Sprint | Continuar y avisar con el comando exacto: el issue queda en el backlog. |
| Worklog parcial | `tally link` solo de las entradas que llegaron; reanudar sobre ese issue. |
| Transición | Atar igual: el tiempo ya está en Jira. |
| `tally link` | Detener la corrida y enseñar el comando exacto para repararlo: otra corrida duplicaría worklogs. |

`tally link <ids> --unlink` devuelve entradas a pendientes; el worklog de Jira
se quita a mano.

## Resumen final

Una fila por tarea: key enlazada, total y una marca por paso (crear, asignar,
fechar, sprint, estimar, worklog, comentar o adjuntar minuta, cerrar, atar, página).
Una casilla que no corrió se deja vacía. Las inconsistencias van arriba.
