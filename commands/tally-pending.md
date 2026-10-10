---
description: Muestra el tiempo de bita que falta subir a Jira, agrupado en tareas
allowed-tools: Bash(tally summary:*)
---

Pendiente de subir a Jira:

!`tally summary --pending`

Resume en pocas líneas: cuántas tareas y cuántas horas faltan, de qué proyectos,
y el rango de días que cubren. Si arriba aparecen entradas excluidas (corriendo,
sin título, sin duración), proyectos sin mapear, solapes o tiempo fuera de Jira,
dilo con las horas exactas; no lo escondas. No escribas nada en Jira: esto es
solo el reporte. Si el usuario quiere subirlo, el siguiente paso es `/tally-push`.
