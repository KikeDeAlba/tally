---
name: tally
description: >-
  Lleva a Jira el tiempo medido en bita. Agrupa las entradas en tareas listas
  para Jira con tally, crea los issues con atl con su jerarquía (Épica →
  Historia → Subtarea), su estimación, un worklog por cada bloque medido y el
  cierre, y deja anotado en tally qué entradas ya se registraron. Úsala cuando
  el usuario quiera ver o reportar en qué trabajó, o volcar ese tiempo a Jira.
  Frases que la disparan: "registra mis horas de esta semana en Jira", "pasa mi
  tiempo a Jira", "qué trabajé esta semana", "sube las horas de ayer", "reporta
  mi tiempo del mes", "registra lo que tengo pendiente", "qué me falta subir a
  Jira". No la uses para arrancar o parar cronómetros (eso es bita) ni para
  tareas de Jira que no vengan de un registro de tiempo.
---

# tally

Las horas las mide **bita**; **tally** las agrupa en tareas de Jira y lleva la
cuenta de qué ya se registró; **atl** es quien escribe en Jira. Nada de estimar
desde commits: las horas son las medidas.

## Quién hace qué

| Herramienta | Qué aporta | Cómo se usa aquí |
|---|---|---|
| bita | Las entradas de tiempo y los proyectos | `bita projects --json`, `bita ls`, `bita merge …`. tally le pide las entradas con `bita entries --json` por su cuenta. |
| tally | El agrupado, los mapeos a Jira y el registro de lo subido | `tally summary`, `tally map …`, `tally link …` |
| atl | Jira (y Confluence) | Sus herramientas MCP `jira_*` o su CLI `atl jira … --json` |
| inkwell | Las notas por entrada, las páginas y el backlog | Lo que traen `docs[]` y `pages[]`; `inkwell page show`, `inkwell backlog add`, `inkwell page link` |
| recap | Las minutas de las reuniones | `recap show --bita-entry <id> --json` |

Ninguna depende de otra: se encuentran entre sí por el registro de kit. Si
`tally summary` responde `BITA_MISSING`, detente y di cómo instalar bita
(`npm install -g @kikedealba/bita && bita setup`). Si atl no está instalado
(`atl --version` falla y no hay herramientas `jira_*`), detente antes de
escribir nada: `npm install -g @kikedealba/atl && atl setup`. Sin inkwell todo
funciona, pero los grupos llegan sin notas ni páginas, solo con títulos.

## Convención del usuario

Cada entrada lleva **título y proyecto**. El estado no es una etiqueta: una
entrada está **pendiente mientras tally no tenga su registro**, y pasa a
registrada cuando `tally link` la ata a un issue. No existe el estado intermedio
que dejaba horas a medio registrar.

El filtro de entrada es `--pending`, no la fecha. El rango es un acotador
opcional.

Leer no cuesta nada: tally y bita son locales, sin red ni cuota. Solo atl habla
con Atlassian. Consulta las veces que haga falta.

Si `meta.warnings` dice que tally no tiene registros y bita sí, la instalación
viene de una versión de bita que llevaba el registro dentro: corre
`tally migrate --from-bita --dry-run`, enséñale los conteos al usuario y, con su
confirmación, `tally migrate --from-bita`. Sin migrar, todo lo ya subido
aparecería como pendiente y una corrida lo duplicaría en Jira.

## Jira a través de atl

**El sitio.** Cada grupo trae `jiraSite`: el sitio de atl de su proyecto (`tally
map set … --site <nombre o URL>`), o el de `tally config set-jira --atl-site`,
o `null`. Con `null`, atl usa su sitio por defecto (`atl site ls`). Pásalo
siempre como `site` (MCP) o `--site` (CLI) cuando no sea `null`.

**MCP o CLI.** Si están las herramientas MCP de atl (`jira_*`, en Claude Code
`mcp__atl__jira_*`), úsalas. Si no, la CLI con `--json`. Las descripciones y los
comentarios se escriben en **markdown** y atl los convierte a ADF; no armes ADF
a mano. Los valores largos se pasan desde archivo con `@archivo.md`.

| Paso | Herramienta MCP de atl | CLI de atl |
|---|---|---|
| Cuenta con la que se escribe | `jira_myself` | `atl jira myself --site <site> --json` (`data.accountId`) |
| Buscar el tablero | `jira_projects` | `atl jira project ls [texto] --site <site> --json` |
| Leer un issue | `jira_get_issue` | `atl jira issue get <KEY> --site <site> --json` |
| Tipos del proyecto | `jira_create_meta` (sin `type`) | `atl jira createmeta <PROYECTO> --site <site> --json` |
| Campos de un tipo | `jira_create_meta` (con `type`) | `atl jira createmeta <PROYECTO> <tipo> --site <site> --json` |
| Crear | `jira_create_issue` | `atl jira issue create --project <KEY> --type <tipo> --summary "<título>" --description @desc.md [--parent <KEY>] [--assignee <accountId>] [--estimate "2h 30m"] [--fields '{"customfield_10015":"2026-10-06"}'] --site <site> --json` |
| Editar | `jira_edit_issue` | `atl jira issue edit <KEY> [--estimate "2h"] [--fields '{…}'] --site <site> --json` |
| Worklog | `jira_add_worklog` | `atl jira worklog add <KEY> --started <startedJira> --time-spent "<timeSpent>" --comment "<texto>" --site <site> --json` |
| Comentario | `jira_add_comment` | `atl jira comment add <KEY> --body @resultado.md --site <site> --json` |
| Transiciones | `jira_transitions` | `atl jira issue transitions <KEY> --site <site> --json` |
| Transicionar | `jira_transition` | `atl jira issue transition <KEY> <id de transición> --site <site> --json` |
| JQL | `jira_search` | `atl jira search "<JQL>" [--limit n] --site <site> --json` |
| Adjuntar | `jira_attach` | `atl jira attach <KEY> <archivo> --site <site> --json` |
| Worklogs ya escritos | `jira_worklogs` | `atl jira worklog ls <KEY> --site <site> --json` |

`--estimate` fija la estimación original (`timetracking.originalEstimate`); los
campos que atl no expone por nombre van en `fields` como JSON crudo.

Si atl responde que no hay sitio o que las credenciales no sirven
(`LOGIN_REQUIRED`, `SITE_NOT_FOUND`, 401), **para** y pide al usuario que corra
en una terminal `atl site add https://<sitio>.atlassian.net --email <correo>`
(o `atl site import --from-bita` si los tenía en bita): el token no lo escribes
tú.

## Reglas duras

1. **No emitas ninguna llamada de escritura antes de una confirmación explícita.**
   Una respuesta ambigua se trata como "ajustar", nunca como "sí".
2. **Resuelve todos los mapeos de proyecto antes de escribir nada.** Si a mitad
   del flujo falta uno, ya habría issues creados y la interrupción dejaría el
   trabajo a medias.
3. **`tally link` es el punto de commit de cada grupo**, y va después de todo lo
   que toca Jira: mientras la entrada no tenga su registro, el trabajo se
   considera no hecho. Perder horas es peor que duplicarlas, y esto es lo que
   evita perderlas. Solo `inkwell page link` va detrás, porque es local y no
   puede hacer perder nada.
4. **Nunca escribas en las bases a mano.** Ni `sqlite3`, ni SQL suelto, ni
   editar `tally.db` o los JSON de configuración: los CLI mantienen las
   invariantes.
5. **No encadenes comandos** con `|`, `;` ni `&&`, y no invoques los CLI con
   `pnpm run`: su banner rompería el parseo del JSON.
6. **La Historia y la Épica son contenedores, no tareas.** No se les pone
   estimación, no se les añaden worklogs, **no se les pone persona asignada ni
   fecha de inicio** y **no se cierran nunca**: cerrar la Historia dejaría
   huérfanas a las subtareas que vengan después. Solo el issue de trabajo
   —Subtarea o Tarea— se estima, se registra, **se asigna**, **se fecha** y se
   transiciona.
7. **Una sola Historia nueva por corrida sin preguntar.** Si el plan crea dos o
   más, para y enséñalas: casi siempre significa que la épica o el tema están
   mal. Jira no fusiona issues, así que una Historia duplicada se limpia moviendo
   subtareas a mano. Lo mismo vale para una **épica nueva**, que solo se propone
   en proyectos que apuntan al tablero (`epicMode: "per-run"`).
8. **Si crear el issue falla por jerarquía, para ese grupo.** No reintentes sin
   `parent`: una subtarea huérfana es inenrutable.
9. **No calcules fechas ni duraciones.** tally ya entrega `startedJira`,
   `timeSpent`, `totalHuman` y `estimateHuman` listos. Cópialos literalmente.
10. **Nada de lo que se publica delata la conversación ni reparte el trabajo.**
    Los issues, los comentarios de Jira y las páginas se escriben como
    documentación técnica de quien tiene asignada la tarea, no como el acta de
    un chat ni como un reparto entre una persona y un asistente. Ver "Cómo se
    escribe lo que se publica".
11. **Toda pregunta de opción cerrada va por la interfaz de preguntas
    disponible.** Nunca escribas un menú numerado en la respuesta para que el
    usuario conteste "1", "2" o "3": la interfaz ya tiene ese menú y elegir en él
    es un clic. Aplica a la confirmación del paso 7, a la elección de
    transición de cierre y a cualquier otra disyuntiva. Lo que sigue en prosa es
    la lista de candidatos de una búsqueda, que puede pasar de cuatro.
12. **Lo que falta nunca va a Jira.** Los pendientes y hallazgos viven en el
    backlog de inkwell (`inkwell backlog add`). No se crean issues, subtareas ni
    Historias para trabajo que no se hizo, no se dejan criterios de aceptación
    sin cumplir como tarea para nadie y no se listan pendientes en los
    comentarios. En Jira solo entra el trabajo medido.
13. **Toda tarea lleva estimación.** Si la pantalla de creación no trae
    `timetracking`, se fija después con la edición del issue (paso 8.2), aunque
    el issue ya esté cerrado: hay proyectos que la aceptan así.
14. **Tope de 8 horas por tarea**, de worklog y de estimación. tally ya parte lo
    que se pasa; no lo deshagas.

## Cómo se escribe lo que se publica

El issue, sus comentarios y lo que se publica en Confluence los va a leer gente
que no estuvo aquí, meses después, buscando por qué algo está como está. Tienen
que leerse como el trabajo de quien tiene asignada la tarea. **Nada en el texto
puede delatar que hubo una conversación, ni quién pidió qué, ni que lo escribió
un asistente, ni que el trabajo se repartió entre alguien que lo hizo y alguien
que tiene que terminarlo.**

### Lista negra

Si una de estas aparece en el texto, la frase está mal y hay que reescribirla
entera, no suavizarla:

- **Quién lo pidió**: "por decisión del usuario", "se acordó con el usuario", "a
  petición del usuario", "según lo solicitado", "el usuario pidió / indicó /
  confirmó / prefirió", "como se solicitó".
- **La conversación**: "en esta sesión", "durante la conversación", "en el
  chat", "como se comentó", "se revisó junto con", "se validó con".
- **Primera persona de charla**: "decidimos", "acordamos", "vimos que", "nos
  dimos cuenta", "optamos por", "revisamos".
- **Relleno burocrático**: "se procedió a", "se llevó a cabo la tarea de", "se
  realizó la implementación de", "cabe destacar", "es importante señalar", "como
  se mencionó anteriormente".
- **Hedging**: "creo que", "parece que", "aparentemente", "podría ser que", "en
  principio", "al parecer", "se asume que".
- **El asistente**: "asistente", "Claude", "IA", "generado automáticamente",
  "agente", y cualquier nombre de herramienta del agente.
- **Narración del tanteo**: "se intentó varias veces", "después de varios
  intentos", "tras probar distintas opciones".
- **Reparto del trabajo**: "yo hice", "hice esto", "esto lo ejecutas tú", "te
  toca", "queda de tu lado", "tú debes", "tienes que", "lo corrí por ti", "lo
  dejo listo para que lo apliques", "el asistente ejecutó", y **cualquier
  segunda persona** dirigida al lector o al usuario. Un issue no le habla a
  nadie: dice qué se necesita y qué quedó.

### La excepción: el acta de una reunión

La descripción de la subtarea de una **reunión** (paso 8, «Si el grupo es
reunión») es un acta, y solo ahí se permite su registro: «se acordó», «se
revisó», «se presentó», «se decidió», «se planteó». Todo lo demás de la lista
negra sigue prohibido también ahí: nada de primera ni segunda persona, ni el
usuario, ni el asistente, ni la conversación con el agente, ni reparto del
trabajo.

### Así no / así sí

| Así no | Así sí |
|---|---|
| Por decisión del usuario se fijó el tope en 8 horas. | El tope por tarea es de 8 horas: Jira rechaza worklogs mayores en una sola entrada. |
| Se acordó usar colas en lugar de procesar en línea. | El procesamiento pasa a una cola: en línea, un pico de reservas bloqueaba las respuestas de la API. |
| Según lo solicitado, se agregó validación al endpoint. | El endpoint valida el id del apartado antes de encolar; sin validación, un id vacío llegaba hasta el consumidor. |
| Se procedió a la migración de la tabla de pagos. | La tabla de pagos se migró a `payments_v2`. |
| Creo que el problema era el token expirado. | El SDK devuelve 200 con cuerpo vacío cuando el token expiró; ese era el fallo. |
| Después de varios intentos logramos que pasaran las pruebas. | `pnpm test`: 148 pasan, 0 fallan. |
| El usuario prefirió no tocar el front en esta iteración. | El front queda fuera de alcance; sigue esperando 201 y funciona con 202. |
| Se analizó el código y se detectaron varios problemas. | `QUEUE_URL` del entorno de dev apunta a la cola de staging desde marzo. |
| Yo dejé listo el plan; el `terraform apply` lo ejecutas tú. | El plan de `compute` está validado: 0 a crear, 3 a cambiar, 13 a destruir. |
| Hice los cambios en el pipeline, te toca probar en QA. | El pipeline despliega a QA con el tag `qa-1.4.0`. |

### Cómo se escribe entonces

- Voz impersonal en pasado ("se migró", "se añadió") o sujeto técnico ("el
  worker reintenta cinco veces"). Nunca "yo", "nosotros" ni "tú".
- **Una afirmación es un hecho comprobable.** Si no se comprobó, no se atenúa
  ni se escribe: va al backlog (`inkwell backlog add --kind pending`).
- **Las decisiones se justifican por su razón técnica, no por su origen.** Si la
  razón real es una preferencia de negocio, se escribe como restricción ("el
  reporte exige bloques de 8 h"), no como autoría.
- El resultado, no el camino.
- **Lo que falta no es una instrucción para nadie.** No se escribe «falta que
  alguien aplique X» en Jira: es un ítem del backlog de inkwell. Lo que se
  publica describe lo que existe.

### La prueba de olfato

Antes de crear el issue y otra vez antes del comentario, lee cada párrafo y
pregunta:

1. **¿Esto lo escribiría alguien en su bitácora técnica, sin haber estado en la
   conversación?** Si suena a acta de reunión, fuera. La única excepción es la
   descripción de una reunión, que es un acta por definición: ahí la pregunta
   es si lo entendería alguien que no estuvo en la reunión.
2. **Si borro la primera mitad de la frase, ¿se pierde información técnica?** Si
   no se pierde nada, esa mitad era relleno o era la conversación.
3. **¿Queda alguna palabra de la lista negra?** Si sí, reescribe la frase
   completa: cambiarle el sujeto no la arregla.
4. **¿Alguna frase le habla a alguien o dice quién hizo qué?** Si sí, fuera: el
   issue es de quien lo tiene asignado, y todo lo que dice es suyo.

## La ventana que sigue existiendo

**Jira es remoto.** El hueco entre escribir el worklog y correr `tally link` es
el único punto donde el estado puede quedar partido, y sigue valiendo la regla:
si algo falla ahí, ata igualmente las entradas que sí llegaron y repórtalo. Los
worklogs de Jira no se borran desde aquí.

## La jerarquía de Jira

Los niveles de este tenant: `Epic` = 1; `Historia`, `Tarea` y `Error` = 0;
`Subtarea` = −1. Un padre tiene que estar en un nivel **superior** al del hijo.

De ahí sale la consecuencia que manda en todo el flujo: **Historia y Tarea están
al mismo nivel, así que una Historia no puede contener Tareas. Solo Subtareas.**

```
Épica     (nivel  1)  el contenedor del proyecto, ya existe
  └─ Historia  (nivel  0)  el tema, inferido, se reusa entre corridas
       └─ Subtarea (nivel −1)  un grupo de tally, con sus worklogs
```

El tiempo se acumula solo hacia arriba: Subtarea → Historia → Épica.

| `hierarchy` | Cuándo | Qué se crea |
|---|---|---|
| `epic-story-subtask` | Por defecto | Historia bajo la épica; Subtareas bajo la Historia |
| `story-subtask` | El proyecto no tiene épica | Historia suelta; Subtareas bajo ella |
| `flat-task` | Solo si el usuario lo pide | Tarea suelta |

### A qué apunta el mapeo

El mapeo de un proyecto apunta **a una épica** o **al tablero**, y tally lo
entrega en cada grupo como `epicMode`:

| `epicMode` | Mapeo | Qué pasa en cada corrida |
|---|---|---|
| `fixed` | Tiene `parentKey` | Todo va a esa épica. `jiraEpicKey` viene lleno. |
| `per-run` | Solo el tablero | La épica se **elige en cada corrida** entre las abiertas del tablero, o la Historia queda suelta. `jiraEpicKey` viene `null`. |
| `flat` | `hierarchy: flat-task` | Tarea suelta, sin épica ni Historia. |

Apuntar a una épica tiene sentido cuando el proyecto siempre cae en la misma. Si
el trabajo se reparte entre varias épicas del tablero, se apunta al tablero.

Verificado en vivo: `VD-4961` es una Historia y obligó a crear Subtareas; las
épicas `INN-1213` e `INN-1216` aceptaron Tareas como hijas.

## Temas canónicos

Las Historias **solo** pueden llamarse como uno de los temas de
`meta.storyThemes`. No inventes nombres: es lo único que evita acabar con
«DevOps», «Dev Ops» e «Infraestructura» como tres Historias distintas.

Por defecto: DevOps · Backend · Frontend · Infraestructura · Análisis y
estimación · Seguridad · Soporte · Sesiones y reuniones · Documentación.

Si un trabajo no encaja en ninguno, **pregunta**; no crees un tema nuevo por tu
cuenta. La caché se indexa por el **id** del tema, así que renombrar el nombre
visible no rompe nada ni renombra Historias ya creadas.

## Procedimiento

### 0. Verificar

```
bita projects --json
tally config get --json
```

Si bita no responde, detente y di cómo instalarlo. Confirma también con qué
cuenta de Atlassian se van a registrar las horas (`jira_myself`, o `atl jira
myself --json`): atl escribe con esa identidad y reasignar un worklog después
es incómodo. Si `tally config get` no tiene `jira.accountId`, guárdalo con
`tally config set-jira --account-id <id>` para la próxima corrida.

**Guarda su `accountId`.** Es el que va en `assignee` de cada issue de trabajo
que crees. Sin él la tarea nace sin dueño: no sale en el tablero de quien hizo
el trabajo ni en los reportes de carga, y las horas quedan colgando de nadie.

**Confirma también el id del campo «Fecha de inicio»** una vez por corrida, con
`jira_create_meta` del tipo de trabajo. En este tenant es `customfield_10015`,
pero es un campo personalizado y su id puede no ser el mismo en otro sitio;
comprobarlo cuesta una llamada y equivocarse deja la fecha en blanco sin avisar.

### 1. Resolver el alcance

- Sin rango: todas las `pending`, con tope de 90 días hacia atrás. tally lo
  avisa; repítelo al usuario.
- Con rango: pásalo como preset (`today`, `yesterday`, `week`, `last-week`,
  `month`, `last-month`), como `--from`/`--to` o como `--last-days N`. **El
  cálculo lo hace bita.**
- Confirma el alcance en una línea antes de seguir.

### 2. Leer y agrupar

```
tally summary --pending --json
```

Devuelve un envelope con `data.groups`. Cada grupo es **una tarea de Jira**:

- `summary` — el título tal cual lo escribió el usuario.
- `totalSeconds` / `totalHuman` — el tiempo real medido, que es lo que suman los
  worklogs.
- `estimateSeconds` / `estimateHuman` — **la estimación original**, redondeada
  hacia arriba al siguiente medio punto. Es este el que va a la estimación, no
  el total: 3h 43m medidas se registran como 4h de estimación con worklogs que
  suman 3h 43m.
- `worklogs[]` — **un worklog por cada bloque de tiempo**, con su `startedJira`
  y su `timeSpent` ya formateados. Una entrada unificada con `bita merge` trae
  un worklog por cada bloque original, con el id de ese bloque.
- `entryIds[]` — las entradas que hay que atar con `tally link` al terminar.
- `jiraProjectKey` — `null` si el proyecto aún no está mapeado. `jiraSite`, el
  sitio de atl.
- `docs[]` — la nota de cada entrada, de inkwell (`markdown`, `sections`,
  `path`). `pages[]` — las páginas de inkwell atadas a esas entradas (`pageId`,
  `title`, `issues`); su cuerpo y sus referencias se leen con
  `inkwell page show <pageId> --json`. Sin inkwell, los dos vienen vacíos.
- `kind` — el tipo de las entradas (`null` si no llevan). Las reuniones
  (`remote-meeting`, `in-person-meeting`) traen además `meeting` (`entryId`,
  `startedAt`, `durationSeconds`, `mode`) y `meetings[]` si el grupo junta
  varias. Una reunión y un trabajo con el mismo título son grupos distintos.
- `partIndex` / `partCount` / `splitReason` — ver el tope de 8 horas.

En `meta` vienen `excluded`, `alreadyRegistered`, `unmappedProjects`,
`nonJira`, `overlaps`, `conflicts`, `storyThemes`, `notes` y `warnings`.

**Proyectos fuera de Jira.** Un proyecto marcado con `tally project jira
<proyecto> off` (por ejemplo, Can Doo with Pet) se mide y se documenta, pero
**nunca va a Jira**. Se revierte con `on`, y `tally map list` enseña cuáles están
fuera. Con `--pending`, sus entradas no aparecen en `groups` ni en
`unmappedProjects`: quedan sumadas en `meta.nonJira` (`totalHuman` y
`projects[]`). No propongas mapearlo, no lo pongas en la propuesta, y repórtalo
aparte en una línea («Fuera de Jira: 3h 30m de Can Doo with Pet»). `tally link`
rechaza esas entradas con `NOT_A_JIRA_PROJECT`. Si el usuario dice que un
proyecto no va a Jira, márcalo así en vez de dejar sus entradas pendientes para
siempre.

### 3. Triaje

Reporta los cubos aunque no se procesen. Ninguno se escribe en Jira:

| Motivo | Qué hacer |
|---|---|
| `running` | Excluir. Di cuáles son (`bita ls`) y ofrece pararlos. Con varios cronómetros a la vez esto es normal, no un error. |
| `no-description` | No inventes título. Lista y pide uno, o déjalas pendientes. |
| `zero-duration` | Excluir: Jira rechaza worklogs de menos de un minuto. |
| `alreadyRegistered` | Solo se cuenta para el reporte. |

**`meta.conflicts`** son entradas unificadas con `bita merge` cuyos bloques ya
estaban registrados en issues distintos, o en parte registrados y en parte no.
Cada bloque se registra por su id, así que lo ya subido no vuelve a salir y lo
pendiente sí: no se duplica ni se pierde nada, pero el trabajo queda repartido
entre varios issues. **Dilo en la propuesta** con los issues y los bloques
(`issues`, `registeredEntryIds`, `pendingEntryIds`) y deja que el usuario decida
si el bloque pendiente va al mismo issue que los registrados (paso 8 sobre ese
issue, sin crear otro) o a uno nuevo.

**`meta.overlaps`** no excluye nada: son los días donde el tiempo registrado
supera el tiempo de reloj cubierto, porque hubo cronómetros solapados. Está
permitido y es intencional. **Dilo en la propuesta** con las horas exactas: quien
lea el reporte en Jira verá un día de 10h y merece saber por qué.

### 4. Tope de 8 horas por tarea

Una tarea admite como máximo **8 horas** de worklog y 8 de estimación original.
tally ya parte lo que se pasa y numera las partes `(1/n)`, `(2/n)`. Cuando veas
`splitReason: "max-task-hours"`, dilo en la propuesta: son varias tareas de Jira
para un mismo título. Con `--max-task-hours N` se cambia el tope.

### 5. Resolver los mapeos faltantes, en un solo bloque

Para cada proyecto en `meta.unmappedProjects`, pregunta a qué tablero de Jira va.
**No listes todos los proyectos**: pide la clave (`DPF`, `INN`) y valídala con
`jira_projects` (o `atl jira project ls <texto> --json`). Si lo que escribe no
parece una clave, trátalo como búsqueda y muestra un máximo de 8 candidatos.

Persiste cada respuesta en cuanto se confirme:

```
tally map set <projectId> <JIRAKEY> --issue-type "Tarea"
tally map set <projectId> <JIRAKEY> --parent <JIRAKEY-123> --issue-type "Tarea"
tally map set <projectId> <JIRAKEY> --site <sitio de atl>
```

`--site` solo hace falta si el tablero no está en el sitio por defecto de atl.

**Varios proyectos pueden compartir tablero y diferir solo en el padre.**
Ese es el caso normal, no la excepción: el mapeo guarda `jiraProjectKey` y
`parentKey` por separado, y tally valida que el padre pertenezca al tablero.

**El padre no siempre es una épica.** Antes de mapearlo, léelo con
`jira_get_issue` y mira su `issuetype.hierarchyLevel`: nivel 1 es una Epic y
puede tener Historias o Tareas dentro; nivel 0 es una Historia o una Tarea y
**solo puede tener Subtareas**.

**La épica se pregunta una sola vez.** Un proyecto con `epicResolved: false` y sin
`jiraEpicKey` todavía no se ha preguntado: hazlo en este mismo bloque.

- Si te da una épica → `tally map set <id> <KEY> --parent <KEY-123>`, y el
  trabajo será `Subtarea` bajo una Historia dentro de esa épica.
- Si dice que **no hay una sola épica** → guárdalo con `--no-epic`, que marca
  `epicResolved: true` y deja el mapeo apuntando al tablero (`epicMode:
  "per-run"`). A partir de ahí la épica se elige en cada corrida (paso 5.5) y,
  si ninguna encaja, la Historia se crea suelta. **No vuelvas a preguntar por
  ese proyecto.**

Sin ese `epicResolved`, los proyectos sin épica se preguntarían en cada corrida
para siempre, que es justo lo que este flujo no debe hacer.

**Cambiar a qué apunta un proyecto** no pierde nada: `map set` fusiona con el
mapeo que ya existe y conserva la transición de cierre, los tipos y la caché de
Historias, que está indexada por épica.

```
tally map set <id> <KEY> --parent <KEY-123>
tally map set <id> <KEY> --no-epic
```

La primera pasa de tablero a épica fija; la segunda, de épica fija a tablero.
Hazlo solo cuando el usuario lo pida, o cuando corrija el destino de un proyecto
con épica fija diciendo que su trabajo no siempre va ahí.

Los proyectos ya mapeados se resuelven en silencio: **no vuelvas a preguntar por
ellos nunca**. Si el usuario cancela a mitad del bloque, aborta la corrida entera.

Entradas **sin proyecto**: no les inventes destino. Lístalas aparte y ofrece
asignarles uno en bita (`bita amend <id> --project <X>`), o dejarlas pendientes.

### 5.5. Resolver la Historia de cada grupo

Antes de crear nada:

0. **Solo si `epicMode` es `"per-run"`: elige la épica.** Con `fixed` la épica
   es `jiraEpicKey` y este subpaso no existe; con `flat` no hay épica ni
   Historia.

   - Trae las épicas abiertas del tablero, una vez por tablero y corrida:

     ```
     project = <KEY> AND issuetype = Epic AND statusCategory != Done ORDER BY updated DESC
     ```

   - Elige por grupo con las mismas señales que el tema: página, título, repo y
     rama. La épica es el frente de trabajo (un cliente, una iniciativa, una
     auditoría), no el tipo de trabajo, que eso es la Historia.
   - Si ninguna encaja, el grupo va a una **Historia suelta**, con la regla de
     búsqueda sin épica del punto 3. Si lo que falta es claramente un frente
     nuevo, propón crear la épica en la propuesta, con su nombre. Cuenta para la
     regla 7 y se crea sin `assignee`, sin estimación y sin cerrarla nunca.
   - Enseña la épica elegida en la tabla de la propuesta. Es la decisión que el
     usuario más probablemente corrija.
   - A partir de aquí, «la épica» es la que elegiste, y la caché de Historias es
     `jiraStoriesByEpic[<épica>]`, o `jiraStoriesByEpic[""]` si la Historia va
     suelta.

1. Elige el tema de la lista cerrada. La señal más fuerte es el **documento**
   del grupo (`pages[]` y `docs[]`). Después el título, el repo y la rama. El
   proyecto acota, no decide.
2. ¿`jiraStories[themeId]` ya tiene una key? → úsala, sin buscar. Con
   `per-run`, mira en `jiraStoriesByEpic` bajo la épica elegida.
3. Si no, trae las Historias de la épica y **empata por igualdad exacta
   normalizada** (trim, espacios, acentos, minúsculas) contra el nombre canónico:

   ```
   project = <KEY> AND issuetype = Historia AND parent = <épica> ORDER BY created DESC
   ```

   **Nunca decidas con `summary ~`.** Tokeniza: «Infraestructura» empata
   «Infraestructura de pruebas del cliente». Sirve para avisar, no para elegir.

   Sin épica (`hierarchy: story-subtask` con épica fija ausente, o `per-run` sin
   épica que encaje), añade `AND parent IS EMPTY AND reporter = currentUser()`:
   sin épica que acote, el riesgo de reusar la Historia de otro es real.
4. Si no hay empate, propón crearla. Al confirmar, créala **sin `assignee`** —es
   un contenedor, no trabajo de nadie— y **persiste la referencia en el mapeo de
   inmediato**, antes de tocar ninguna subtarea:
   `tally map story <projectId> <themeId> <ISSUE-KEY>`. Con `per-run` di bajo
   qué épica cuelga —`--epic <KEY-123>` o `--no-epic`—: tally lo exige, porque
   la misma Historia de tema existe una vez por épica.

Si un grupo mezcla notas de temas distintos, gana el mayoritario y **dilo en la
propuesta**: suele ser un cronómetro que se dejó correr a través de un cambio de
tema.

### 6. Preflight por proyecto

Una vez por combinación de proyecto y tipo de issue:

- `jira_create_meta` sin tipo → los tipos del proyecto. **Los tipos están en
  español**: "Tarea", "Historia", "Error", "Subtarea", "Epic". Nunca asumas
  "Task".
- `jira_create_meta` con el tipo → si `timetracking` está en la pantalla, y qué
  campos son obligatorios.

Si el proyecto no expone `timetracking` en la creación, la estimación se fija
después con la edición (paso 8.2). Si tampoco la acepta ahí, **registra el
worklog igual** y avísalo una vez por proyecto, no una por issue.

### 7. Propuesta y confirmación

Tabla con una fila por tarea: proyecto → Jira, tipo, resumen, número de
worklogs, rango de fechas, total y estimación. Si algún grupo es `per-run`,
añade la columna de épica e Historia elegidas, marcando lo que se va a crear.
Debajo, lo excluido con su motivo, los solapes y lo que queda fuera de Jira.

**Las tareas se cierran al terminar. No lo preguntes.** Solo se dejan abiertas si
el usuario lo pide explícitamente, y entonces dilo en la tabla.

La confirmación se pide con la interfaz de preguntas disponible, con estas
cuatro opciones:

| Opción | Qué hace |
|---|---|
| Confirmar y escribir | Crea todo lo de la tabla, de una tacada. |
| Ajustar | Fusionar, partir, renombrar, cambiar proyecto o excluir grupos. |
| Ver el detalle | El payload literal de un grupo, antes de decidir. |
| Cancelar | No se escribe nada. |

La tabla de la propuesta va **antes** de la pregunta, en la respuesta: es lo que
el usuario necesita leer para elegir, y en la pregunta no cabe.

**Esta es la única parada.** Confirmado el menú, se escriben todos los grupos sin
volver a preguntar.

Si la frase del usuario fue de consulta ("qué trabajé esta semana"), **termina
aquí**: eso es el reporte, no hay escritura.

### 8. Escribir, grupo por grupo

Todos los grupos, uno detrás de otro, sin parar a confirmar entre medias. Y dentro
de cada grupo, este orden, sin paralelismo. **Si el grupo es reunión** (`kind`
`remote-meeting` o `in-person-meeting`), la descripción, el comentario y el
adjunto cambian: ver «Si el grupo es reunión» al final de este paso.

0. **La Historia ya está resuelta** en el paso 5.5 y persistida en el mapeo.
   Si tuviste que crearla, no le pongas estimación ni la cierres nunca. Si el
   grupo es `per-run` y llevaba épica nueva, esa épica se crea primero, y la
   Historia con `parent` = esa épica.
1. **Crear el issue de trabajo** (`jira_create_issue`) como
   **`jiraWorkIssueTypeName`** (`"Subtarea"` por defecto) con `parent` = la key
   de la Historia. El tipo va por **nombre**. Con `flat`, es
   `jiraIssueTypeName` (o «Tarea») sin `parent`.
   - `summary`: el del grupo, **literal**, sin reescribir. Es la clave de
     agrupación y lo que el usuario reconocerá al buscar.
   - `description`: **el requerimiento**, no el informe. Se escribe como se
     habría escrito la tarea antes de empezar: qué se necesita, por qué y cómo
     se sabe que está hecha. Nada de resultados, bitácora, tablas de archivos
     ni el cuerpo de la página pegado. Tres secciones, cortas:

     ```
     ## Objetivo
     Uno o dos párrafos: qué se necesita y por qué importa.

     ## Alcance
     - Lo que entra, en viñetas concretas (servicio, ambiente, componente).
     - Lo que queda fuera, si evita una confusión probable.

     ## Criterios de aceptación
     1. Condición verificable
     2. Condición verificable
     ```

     Sale del título del grupo, de sus páginas (`pages[]`, con `inkwell page
     show`) y de sus notas (`docs[]`), **reformulado como necesidad**: «Se migró
     la búsqueda a la L4» es resultado; «Migrar la búsqueda por imagen a la
     instancia L4 para bajar el costo de inferencia» es requerimiento. Los
     criterios son los que el resultado cumple, así que quien lea el comentario
     de resultados puede cotejarlos uno por uno. Van **numerados**, no como
     casillas: `- [ ]` se ve en Jira como el texto literal `[ ]`. La
     Verificación del comentario sigue la misma numeración.
     **Antes de enviarla, pásale la prueba de olfato**: es el texto que verán
     otros.

     Una nota con `markdown: null` y `truncated: true` se lee de su `path` con
     Read. Sus secciones «Hallazgos» y «Pendiente» no van a Jira: van al backlog
     con `inkwell backlog add`. Un grupo sin página y sin nota se describe con su
     título.
   - `assignee`: **siempre**, con el `accountId` del paso 0. Es la única pieza
     del payload que Jira no deduce de nada y que nadie echa en falta hasta que
     busca su propio trabajo y no lo encuentra.
   - **Fecha de inicio** (`customfield_10015` en este tenant, en `fields`):
     **siempre**, con `days[0]` del grupo, en `YYYY-MM-DD`. Es el día en que
     empezó el trabajo, no el día en que se registró: sin ella, los informes y
     las vistas de cronograma colocan la tarea el día del volcado, que puede ser
     semanas después.
   - `estimate` = `estimateHuman`, ya en la creación si la pantalla trae
     `timetracking`; ahorra una llamada. Si hace falta fijar también el
     restante, va en `fields`: `{"timetracking":{"originalEstimate":"<estimateHuman>","remainingEstimate":"0m"}}`.
2. Solo si el proyecto no admitía `timetracking` en la pantalla de creación,
   `jira_edit_issue` con la misma estimación y `remainingEstimate: "0m"`.
   **Siempre antes del worklog**: algunos workflows bloquean la edición una vez
   cerrado el issue, y fijar el cero explícitamente es correcto tanto si Jira
   decrementa solo como si no. Si la edición no la acepta tampoco, sigue y
   avísalo.
3. `jira_add_worklog` **una vez por cada entrada de `worklogs[]`**, copiando
   `startedJira` y `timeSpent`. En el comentario, el rastro de auditoría:
   `bita · <startLocal> · bita:<entryId>`. Guarda el id de cada worklog que
   devuelva atl.
4. `jira_add_comment` con **los resultados**, un solo comentario por issue y por
   corrida, en markdown:

   ```
   ## Resultado
   Qué existe ahora que no existía, en presente y con nombres concretos
   (recurso, versión, endpoint, rama, MR).

   ## Verificación
   El comando o la comprobación y lo que dio. Un criterio de aceptación por
   viñeta, en el mismo orden que la descripción.

   ## Referencias
   - [Título de la página de Confluence](https://…/wiki/spaces/…) — espacio X.
   - MR: [repo !3](https://…/-/merge_requests/3), [!4](https://…/-/merge_requests/4).
   ```

   **Toda referencia lleva su enlace**, también las MR que se citan en
   Resultado: `[texto](url)`, nunca un título suelto que obliga a buscarlo. Las
   URLs salen de las referencias de la página (`inkwell page show <pageId>
   --json`). Si una referencia no está ahí, se busca antes de escribir
   —`confluence_search` por título para Confluence, la API del GitLab del repo
   para una MR (confirmando que existe)— y se registra en la página con
   `inkwell page ref add` para que la próxima corrida ya la tenga. Lo que no
   tiene URL que se pueda confirmar no se cita.

   Lo que el requerimiento pedía y **no** quedó hecho no se escribe como tarea
   para nadie: se dice en Resultado qué alcance quedó cubierto y el resto va al
   backlog de inkwell con `inkwell backlog add`: ni un issue nuevo, ni una
   subtarea, ni una lista de pendientes en el comentario. Mismas reglas de
   redacción que la descripción. **Pásale la prueba de olfato antes de
   enviarlo.**
5. Cierra el issue: `jira_transitions` y elige **por lo que devuelva**, nunca
   por nombre a ciegas. Ver abajo. Sáltalo solo si el usuario pidió dejarlas
   abiertas.
6. **`tally link <entryIds...> --issue <ISSUE-KEY> --json`**, en una sola llamada
   por grupo, con todos los `entryIds` del grupo. Es una transacción local: o
   quedan atadas todas o ninguna. Si atl devolvió un solo worklog por entrada,
   puedes pasar sus ids en el mismo orden con `--worklog <id>` repetido; si no,
   omítelo.
7. `inkwell page link <pageId> --issue <ISSUE-KEY> --summary "<el summary del
   issue>" --status "<el estado en que quedó>" --status-category <categoría>`,
   **una llamada por cada página de `pages[]`**. Esto no se pregunta ni se
   pospone: es lo que hace que la página enseñe las tareas que salieron de ella,
   y este es el único momento en que tienes el estado a mano. La categoría es la
   `to.statusCategory.key` de la transición que aplicaste (`done` si lo
   cerraste), o la del estado en que nació si lo dejaste abierto. Repetir la
   llamada con la misma clave **actualiza** la fila, no la duplica.

   Un grupo sin `pages[]` no tiene página donde atar: sáltalo y dilo en el
   resumen final. Sin inkwell instalado, este paso no existe.

#### Si el grupo es reunión

Una reunión no es una actividad entregable: su subtarea lleva la información de
la reunión y la minuta adjunta en PDF, no un requerimiento ni un comentario de
resultados. Los grupos que no son reuniones siguen exactamente como arriba.

- **Historia**: «Sesiones y reuniones», siempre. Se resuelve como cualquier
  otra en el paso 5.5, pero el tema no se elige: es ese.
- **`summary`**: el título de la reunión, que es el del grupo, literal.
- **`description`**: sale de la minuta, no de las páginas ni de las notas.
  `recap show --bita-entry <meeting.entryId> --json` → `data.summary` es la ruta
  de `summary.md`; léelo con Read. Plantilla:

  ```
  ## Reunión
  - Fecha: <día y hora local>
  - Duración: <h m>
  - Modalidad: Remota | Presencial

  ## Resumen
  <el resumen de la minuta>

  ## Temas tratados
  - <tema>

  ## Acuerdos
  1. <acuerdo>

  ## Minuta
  Adjunta en PDF.
  ```

  La fecha y la hora son las de `meeting.startedAt`, que ya viene en hora local
  («8 de octubre de 2026, 10:13»); la duración es el `totalHuman` del grupo; la
  modalidad, `Remota` si `mode` es `remote` y `Presencial` si es `in-person`.
  El resumen, los temas y los acuerdos salen de las secciones «Resumen», «Temas»
  y «Acuerdos» de la minuta, redactados como reunión: un tema por viñeta, sin
  las marcas de minuto (`[00:01:31]`), y los acuerdos **numerados** en el mismo
  orden. Si no hubo acuerdos, la sección dice «Sin acuerdos.».
- **Los pendientes y las preguntas abiertas no van a la descripción.** Se
  quedan en el PDF y en el backlog de inkwell, donde recap ya los dejó: es la
  regla 12.
- **Redacción**: se permite el registro de acta («se acordó», «se revisó»);
  ver «La excepción: el acta de una reunión». El resto de la lista negra y la
  prueba de olfato siguen valiendo.
- **No se escribe el comentario de resultados**: el paso 4 se salta.
- **La minuta en PDF**, después de los worklogs y antes de cerrar, una vez por
  cada entrada de `meetings[]`:

  ```
  inkwell export meeting --bita-entry <entryId> --json
  atl jira attach <ISSUE-KEY> <data.path> --site <site> --json
  ```

  Si el export falla porque la reunión no se grabó, la descripción se arma con
  el título y lo que haya en la página, sin la sección «Minuta», y se dice en el
  resumen final. Si falta Chrome, recap o inkwell, la subtarea se crea igual sin
  el PDF, y se reporta para adjuntarlo después.
- **Igual que cualquier grupo**: asignado, fecha de inicio, estimación,
  worklogs, cierre, `tally link` e `inkwell page link`.

Al terminar, una tabla con una fila por tarea y una columna por paso —crear,
asignar, fechar, estimar, worklog, comentar (o adjuntar la minuta, en las
reuniones), cerrar, atar las entradas, atar la página—, la key enlazada y el
total registrado. Debajo, lo que se saltó y por qué. Es el único sitio donde se
ve que un paso no corrió, así que una casilla vacía se deja vacía: no se rellena
por simetría.

### Elegir la transición de cierre

1. Filtra las transiciones cuyo `to.statusCategory.key === "done"`.
2. Si queda **una**, úsala.
3. Si quedan **varias**, elige por el **nombre del estado destino (`to.name`)**,
   nunca por el nombre de la transición. No son lo mismo y confundirlos cancela
   trabajo: en **VBGLOBAL la transición se llama «Listo» pero su `to.name` es
   «Cancelado»**, y la de cierre real es «Closed» → «Cerrada».

   - Orden de preferencia sobre `to.name`: Finalizada, Finalizado, Cerrada,
     Cerrado, Hecho, Completada, Terminado, Done.
   - **Descarta siempre** los `to.name` que suenen a abandono o a paso
     intermedio: Cancelado, Cancelada, Duplicado, No se hará, Rechazado,
     READY TO TEST, Ready to test.
   - Si tras eso sigue habiendo varias, **pregunta**. Propónla en la
     confirmación la primera vez.
4. Si **ninguna** está en categoría `done`, da **un solo salto** hacia una
   `indeterminate` y vuelve a consultar. Máximo dos saltos. Nunca iteres
   transiciones a ver cuál pega: cada intento dispara notificaciones y
   automatizaciones.
5. Si la transición **pide campos obligatorios**: rellena `resolution` solo si
   hay un único candidato evidente. En cualquier otro caso deja el issue abierto
   y repórtalo. Una resolución mal puesta contamina las métricas del equipo.

Transiciona siempre por **id** (`atl jira issue transition <KEY> <id>`), el de la
transición que elegiste. atl también acepta `done`, que toma cualquier
transición a la categoría done: no lo uses cuando haya varias candidatas.

## Manejo de fallos

| Falla en | Qué queda | Qué hacer |
|---|---|---|
| Crear el issue | Nada escrito, entradas pendientes | Reintentar es seguro |
| Estimación | Issue sin estimación | Continuar sin ella y avisar |
| Worklog **parcial** | Issue con worklogs incompletos | `tally link` **solo** las entradas que sí quedaron, anotar la key, reanudar sobre ese issue |
| Transición | Issue correcto, abierto | **Atar igual**: el tiempo ya está registrado, y dejarlas pendientes duplicaría worklogs |
| `tally link` | Jira sí, tally no | **Detén la corrida entera** y enseña el comando exacto para repararlo |

`tally link` es local y transaccional, así que fallar ahí es raro: significa que
la base no se puede escribir o que bita no respondió al validar las entradas.
Cuando pase, el tiempo ya está en Jira y las entradas siguen pendientes, así que
**una segunda corrida duplicaría los worklogs**. Adviértelo explícitamente. Los
worklogs duplicados se limpian a mano en Jira.

Si te equivocaste de issue, `tally link <ids> --unlink` devuelve las entradas a
pendientes; el worklog de Jira hay que quitarlo a mano.

Antes de crear un issue, un `jira_search` de aviso
(`project = X AND summary ~ "..." AND reporter = currentUser() AND created >= -30d`)
detecta posibles duplicados. **Avisa, no decide**: es una búsqueda difusa.

## Resumen final

Una fila por tarea con ocho marcas — crear, **asignar**, **fechar**, estimar,
worklog, **comentar**, cerrar, atar — el enlace al issue y el total. Cualquier
inconsistencia va **arriba**, no al final. Si algo quedó pendiente de hacer,
va al backlog de inkwell, no a esta tabla como tarea.

## Reglas de agrupación

Esta sección es editable a mano; es la palanca principal para ajustar el
comportamiento.

- Clave de agrupación: **proyecto + título**, a lo largo de todo el rango.
  Un grupo puede cruzar días y no se parte por eso.
- El título se compara sin espacios de más y sin puntuación final; por defecto **se
  distinguen mayúsculas** (`--case-insensitive` las une).
- tally **no fusiona por similitud**. "Refactor pagos" y "refactor de pagos" son
  dos tareas. Si ves títulos casi iguales, sugiere la fusión en la propuesta y
  deja que decida el usuario.
- **Unificar contadores.** Cuando varios cronómetros son un mismo trabajo —la
  misma sesión partida, o títulos distintos para la misma tarea—, se unifican
  en bita antes de volcar, con confirmación:

  ```
  bita merge <ids...> --dry-run
  bita merge <ids...> [--into <id>] [--title "…"] [--project X]
  ```

  El primero enseña cómo quedaría. Queda **una entrada** con el título y el
  proyecto elegidos, y **cada bloque original como segmento**: Jira recibe una
  sola tarea con un worklog por bloque, con sus horas reales. Solo entradas
  pendientes y paradas. Después se vuelve a pedir `tally summary`.
- Cuidado con títulos genéricos ("daily", "junta", "soporte"): pueden colapsar
  semanas en un issue gigante. El rango de fechas por grupo lo hace visible en la
  propuesta.

::: agent codex
## atl en Codex

`atl setup` registra su servidor MCP en `~/.codex/config.toml`. Codex puede
mostrar los nombres de las herramientas sin el prefijo del servidor: usa la
herramienta `jira_*` equivalente y no inventes una variante por diferencias de
nombres. Si no aparece ninguna, usa la CLI `atl jira … --json`.
:::

::: agent opencode
## atl en OpenCode

`atl setup` registra su servidor MCP en la configuración global de OpenCode.
Las herramientas pueden aparecer con el prefijo `atl_` o dentro del grupo
`tools.atl`, según la configuración de Code Mode. Usa la herramienta `jira_*`
equivalente y no inventes una variante por diferencias de nombres. Si no aparece
ninguna, usa la CLI `atl jira … --json`.
:::

::: agent gemini
## atl en Gemini CLI

`atl setup` declara su servidor MCP en la extensión `atl` de Gemini CLI. Usa la
herramienta `jira_*` equivalente y no inventes una variante por diferencias de
nombres. Si no aparece ninguna, usa la CLI `atl jira … --json`.
:::
