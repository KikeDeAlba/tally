---
name: tally-push
description: Sube a Jira el tiempo pendiente de bita, con confirmación
argument-hint: "[today|yesterday|week|last-week|month|last-month | --from YYYY-MM-DD --to YYYY-MM-DD]"
disable-model-invocation: true
allowed-tools: Bash(tally summary:*), Bash(tally map:*), Bash(tally config:*), Bash(tally project jira:*), Bash(tally issue:*), Bash(tally paths:*)
---

Vuelca a Jira el tiempo pendiente de bita. Alcance: `$ARGUMENTS` (vacío = todo
lo pendiente de los últimos 90 días). Nada se escribe en Jira antes de que el
usuario confirme.

Si está disponible el subagente `tally-push`, el trabajo con Jira lo hace él,
en dos llamadas, y aquí solo se pregunta y se confirma:

1. **Plan.** Llama al subagente `tally-push` con «modo plan, alcance:
   $ARGUMENTS» y la ruta de la skill `tally`: el directorio `tally` hermano del
   directorio base de esta skill o, si no hay directorio base, `data.skill` de
   `tally paths --json`. Devuelve la propuesta (una fila por tarea) y la lista de
   decisiones pendientes: proyectos sin mapear con sus candidatos, épicas e
   Historias por crear, tablero o sprint cuando hay varios, conflictos, solapes y lo que queda fuera.
2. **Decisiones.** Resuelve cada decisión con la interfaz de preguntas, todas
   en un solo bloque. Los mapeos que confirme el usuario se guardan aquí mismo
   con `tally map set <projectId> <KEY> [--parent <EPIC> | --no-epic]`. El
   tablero elegido, con `tally map board <projectId> <boardId>`. Si se
   guardó alguno, repite el paso 1: sin mapeo, esos grupos no traían épica ni
   Historia, y la propuesta que se confirma tiene que ser la completa.
3. **Confirmación.** Enseña la tabla de la propuesta y pregunta una sola vez:
   Confirmar y escribir · Ajustar · Ver el detalle · Cancelar. Con «Ajustar»,
   vuelve al paso 1 con los cambios; con «Cancelar», termina sin escribir.
4. **Escritura.** Llama al subagente `tally-push` con «modo escribir», el
   alcance, la ruta de la skill `tally` y la propuesta aprobada, literal, con
   las decisiones tomadas.
5. **Resultado.** Enseña la tabla que devuelve tal cual, con lo que falló o
   quedó por decidir arriba.

Si no hay subagente, sigue el procedimiento de la skill `tally` (su
`procedure.md`) de principio a fin, con la misma confirmación única antes de
escribir.
