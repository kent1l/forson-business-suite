// Converts captured actual HTTP/SQL/serializer outputs to assertion observations.
// Missing subchecks remain missing; this does not manufacture success observations.
module.exports = function observations(api, pure) {
 const h=Object.fromEntries(api.results.map(r=>[r.id,r]));
 const b=Object.fromEntries(pure.results.map(r=>[r.id,r]));
 return {
  A12:{parallel_requests:h.H05.statuses.length,distinct_part_links:h.H05.rows,all_outcomes_saved_or_existing:h.H05.statuses.every(s=>s===200||s===201),no_association_side_effect:h.H03.association[0].year_start===h.H03.links[0].year_start&&h.H03.association[0].year_end===h.H03.links[0].year_end},
  A13:{chassis_id_retained:h.H12.status<300&&Boolean(h.H12.actual.chassis_id)},
  A14:{make_only_status:h.H13.actual.approval_status??'absent'},
  A15:{parser_rejects:b.B08.target_passes,application_route_rejects:h.H01.status===422},
  A16:{restriction_loss:[b.B07,b.B11].filter(r=>!r.target_passes).length},
  A17:{stale_http_status:h.H14.status,engine_query_does_not_match_different_explicit_engine:h.H19.actual[0].rows===0},
  A18:{whole_phrase_alias_http_status:h.H08.status},
  A19:{research_endpoint_exists:h.H16.status!==404},
  A20:{unauthorized_http_status:h.H06.status,partial_writes:h.H07.links.length,client_verification_rejected:h.H14.status===400||h.H14.status===422,stale_rule_http_status:h.H14.status},
  A21:{atomic_engine_ids_preserved:h.H18.application_document.engine_id===101,status_visible:Object.hasOwn(h.H18.application_document,'approval_status')},
 };
};
