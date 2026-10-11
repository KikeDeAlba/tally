---
name: tally-pending
description: Muestra el tiempo de bita pendiente de subir a Jira
argument-hint: "[today|yesterday|week|last-week|month|last-month | --from YYYY-MM-DD --to YYYY-MM-DD]"
disable-model-invocation: true
allowed-tools: Bash(tally summary:*)
---

Pendiente de subir a Jira:

!`tally summary --pending $ARGUMENTS`

Resume en pocas líneas: cuántas tareas y cuántas horas faltan, de qué proyectos
y qué días cubren. Si arriba aparecen entradas excluidas (corriendo, sin título,
sin duración), proyectos sin mapear, solapes o tiempo fuera de Jira, dilo con
las horas exactas. No escribas nada en Jira: es solo el reporte. Para subirlo,
el siguiente paso es `/tally-push`.
