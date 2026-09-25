/** Only explicitly configured dates have a school-day setting. */
export function createDayPlanResolver(plans){
  return iso=>plans[iso];
}
