# Grupos de reunión

Grabar, consultar y rehacer minutas es de **recap** (skill `recap`). Aquí solo
está lo que cambia al volcar un grupo con `kind` `meeting`, `remote-meeting` o
`in-person-meeting`. Todo lo demás sigue `procedure.md`: asignado, fecha de
inicio, estimación, worklogs, cierre, `tally link` e `inkwell page link`.

- **Historia**: siempre «Sesiones y reuniones» (tema `sesiones`).
- **`summary`**: el título del grupo, literal.
- **Descripción**: sale de la minuta, no de las notas.
  `recap show --bita-entry <meetings[0].entryId> --json` → `data.summary` es la
  ruta de `summary.md`; léelo. Plantilla:

  ```
  ## Reunión
  - Fecha: <meetings[0].startedAt, en hora local>
  - Duración: <totalHuman>
  - Modalidad: Remota | Presencial

  ## Resumen
  <resumen de la minuta>

  ## Temas tratados
  - <tema, sin marcas de minuto>

  ## Acuerdos
  1. <acuerdo> (o «Sin acuerdos.»)

  ## Minuta
  Adjunta en PDF.
  ```

  `mode` `remote` es Remota; `in-person`, Presencial.
- **Pendientes y preguntas abiertas** no van a la descripción: quedan en el
  PDF y en el backlog de inkwell, donde recap ya los dejó.
- **Redacción**: aquí se permite el registro de acta («se acordó», «se
  revisó»); el resto de las reglas de redacción sigue valiendo.
- **Sin comentario de resultados.**
- **Minuta en PDF**, después de los worklogs y antes de cerrar, una vez por
  cada `meetings[]`:

  ```
  inkwell export meeting --bita-entry <entryId> --json
  atl jira attach <KEY> <data.path> --json
  ```

  Si la reunión no se grabó, la descripción va sin la sección «Minuta» y se
  dice en el resumen final. Si falta recap, inkwell o Chrome, la subtarea se
  crea igual y se reporta el PDF pendiente.
