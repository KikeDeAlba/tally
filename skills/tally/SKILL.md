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

**bita** mide el tiempo, **tally** lo agrupa en tareas de Jira y anota qué ya se
subió, **atl** escribe en Jira (solo su CLI, `atl jira … --json`), **inkwell**
aporta notas y páginas, y **recap** las minutas de reunión. Las horas son las
medidas: nada de estimar desde commits.

## Cuándo

- **Consulta** («qué trabajé», «qué me falta subir»): `tally summary --pending`
  (o con rango; la tabla basta) y resume. No se escribe nada.
- **Volcado** («sube mis horas a Jira»): el procedimiento completo de
  [procedure.md](procedure.md). Si está el subagente `tally-push`, delega en
  él en dos llamadas: «modo plan» (devuelve propuesta y decisiones) y, tras
  resolver las decisiones y confirmar aquí con el usuario, «modo escribir» con
  la propuesta aprobada. Pásale siempre la ruta del directorio de esta skill.
  Trabaja en su propia ventana y devuelve solo la tabla de lo creado. Es lo
  mismo que hace `/tally-push`.
- Grupos de **reunión** (`kind` `remote-meeting` o `in-person-meeting`): lo que
  cambia está en [meetings.md](meetings.md).

Sin bita (`BITA_MISSING`): `npm install -g @kikedealba/bita && bita setup`. Sin
atl (`atl --version` falla): `npm install -g @kikedealba/atl && atl setup`, y
no se escribe nada. Sin inkwell todo funciona, con títulos y sin notas.

## Flujo en breve

1. **Verificar**: `tally config get --json` y `atl jira myself --json` (cuenta
   con la que se escribe; guárdala con `tally config set-jira --account-id`).
2. **Alcance**: sin rango, todo lo pendiente de 90 días; con rango, un preset
   (`today`, `week`, `last-month`…) o `--from`/`--to`. Lo calcula bita.
3. **Agrupar**: `tally summary --pending --brief --json`. Cada elemento de
   `data.groups` es una tarea de Jira; el destino de su proyecto está en
   `data.projects[projectId]`.
4. **Triaje**: excluidas, solapes, conflictos de merge, tiempo fuera de Jira y
   tareas partidas por el tope; todo se dice con sus horas.
5. **Mapeos faltantes** (`meta.unmappedProjects`), en un solo bloque, antes de
   escribir nada: `tally map set <projectId> <KEY> [--parent <EPIC> | --no-epic]`.
6. **Historia de cada grupo** por tema canónico, y la épica si el proyecto es
   `per-run`.
7. **Propuesta y una sola confirmación.**
8. **Escribir grupo por grupo**: crear la subtarea (asignada, con fecha de
   inicio y estimación), un worklog por bloque, comentario de resultados,
   cierre, `tally link` e `inkwell page link`.

## Reglas duras

1. **Nada se escribe en Jira sin una confirmación explícita** de la propuesta.
   Una respuesta ambigua es «ajustar», nunca «sí». Una sola parada: confirmado,
   se escriben todos los grupos sin volver a preguntar.
2. **Toda tarea lleva estimación** (`estimateHuman`). Si la pantalla de creación
   no trae `timetracking`, se fija con `atl jira issue edit`, aunque el issue ya
   esté cerrado.
3. **Tope de 8 horas por tarea**, de worklog y de estimación. tally ya parte lo
   que se pasa (`part`); no lo deshagas.
4. **La épica se pregunta una vez por proyecto** y queda en el mapeo. Solo los
   proyectos `per-run` (mapeados al tablero) eligen épica en cada corrida.
5. **Ningún envío duplicado.** `tally link` es el punto de commit de cada grupo
   y va después de todo lo que toca Jira; lo atado ya no sale en `--pending`. Si
   algo falla después de un worklog, ata lo que sí llegó y repórtalo. Nunca
   relances una corrida sobre entradas que quedaron en Jira sin atar.
6. **Una sola Historia o épica nueva por corrida sin preguntar.** Historia y
   épica son contenedores: sin estimación, sin worklogs, sin asignar, sin fecha
   y sin cerrar.
7. **Si crear falla por jerarquía, para ese grupo.** No reintentes sin padre.
8. **No calcules fechas ni duraciones**: copia `startedJira`, `timeSpent`,
   `totalHuman` y `estimateHuman` tal cual.
9. **Nunca escribas en las bases a mano** (`tally.db`, JSON de config) y no
   encadenes comandos con `|`, `;` ni `&&`.
10. **Lo que falta nunca va a Jira**: va al backlog de inkwell
    (`inkwell backlog add`).
11. **Solo atl.** Si responde `LOGIN_REQUIRED`, `SITE_NOT_FOUND` o 401, para y
    pide al usuario `atl site add https://<sitio>.atlassian.net --email
    <correo>` en su terminal; el token no lo escribes tú.

## Redacción

Reglas de redacción: corre `inkwell guide writing` (fuente única, en inkwell)
antes de escribir descripciones y comentarios. Si inkwell no está, lo mínimo:

- Voz impersonal o sujeto técnico; nunca «yo», «nosotros» ni «tú».
- Nada delata la conversación, quién pidió qué ni al asistente.
- Hechos comprobables, sin hedging ni relleno; el resultado, no el camino.
- Las decisiones se justifican por su razón técnica, no por su origen.
- Lo que falta no es una instrucción para nadie: va al backlog.

## Proyectos fuera de Jira

`tally project jira <proyecto> off` deja un proyecto fuera de Jira: sus horas
quedan en `meta.nonJira`, no se proponen ni se mapean, y se reportan aparte en
una línea. `tally link` las rechaza con `NOT_A_JIRA_PROJECT`.

## Unificar contadores

Si varios cronómetros son un mismo trabajo, se unifican en bita antes de volcar
y con confirmación: `bita merge <ids...> --dry-run` y luego `bita merge <ids...>
[--into <id>] [--title "…"]`. Queda una tarea con un worklog por bloque. tally
no fusiona por similitud: títulos casi iguales se sugieren en la propuesta.

Si `meta.warnings` dice que tally no tiene registros y bita sí, primero
`tally migrate --from-bita --dry-run`, se enseñan los conteos y, con
confirmación, `tally migrate --from-bita`. Sin migrar, lo ya subido saldría como
pendiente.
