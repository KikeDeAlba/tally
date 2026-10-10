---
description: Sube a Jira el tiempo pendiente de bita, con confirmación
argument-hint: "[today|yesterday|week|last-week|month|last-month | --from YYYY-MM-DD --to YYYY-MM-DD]"
allowed-tools: Bash(tally summary:*), Bash(tally map:*), Bash(tally link:*), Bash(tally config get:*), Bash(bita projects:*)
---

Vuelca a Jira el tiempo pendiente siguiendo el procedimiento completo de la
skill `tally`, de principio a fin: verificar la cuenta, resolver el alcance,
agrupar con `tally summary --pending --json` $ARGUMENTS, triaje, mapeos
faltantes en un solo bloque, Historia de cada grupo, preflight, propuesta con
una sola confirmación, y después escribir grupo por grupo con atl (crear,
asignar, fechar, estimar, un worklog por bloque, comentar, cerrar) y atar las
entradas con `tally link`.

Sin argumentos, el alcance es todo lo pendiente de los últimos 90 días. Nada se
escribe en Jira antes de que el usuario confirme la propuesta.
