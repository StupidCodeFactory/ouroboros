any(.subIssues[];
  (.column | IN("QA", "Done"))
  and any(.comments[]; startswith("## Review found defects")))
