Typed-object fixtures (2026-10-20), in exactly the shape of the typed objects architecture D5
(plans/2026-10-20-typed-objects/README.md): a run graph as gardend's workflow_run_record writes it once it types items.

  run-typed-item.ttl     a typed dream report (a wf:Item AND a <Class>, field triples, wf:producedBy, wf:sitting,
                         prov:generatedAtTime), with a nested value: the child node <item>/stimulus (D2 "Nesting")
                         and a multi nested list <item>/witnesses/<i>.
  run-unfit-item.ttl     an item that did not fit: a wf:Item and a wf:Unfit, no class, its wf:violation messages,
                         and its wf:json kept.
  run-untyped-item.ttl   today's untyped item: a wf:Item with wf:json only.
  run-record.ttl         the run node (wf:GraphPlanRun) the items are part of.
  beings.ttl             the being that made the typed item, with its label (another graph).
  freud-dreams-workspace.vocab.json
                         what emporium_vocab answers for the graph's domain vocabulary once it serves classCatalog
                         (§4 "Type catalogue"): one entry per class, a nested class among them.

Each .ttl is loaded into the named graph its first comment line names. Align with the gardend agent's sample triples
when they land.
