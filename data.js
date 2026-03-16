/**
 * Daily CTL production report — matches director email format.
 * Update this when you receive a new daily email (or later wire to email/API).
 */

var DOWNTIME_COST_PER_HOUR = { '½ line': 450, 'Redbud': 700 };
var MONTHLY_BUDGET_PCT = 0.75;   // 75% of total hours available = budgeted hours
var HOURS_AVAILABLE_PER_LINE_PER_DAY = 24;   // 2 shifts × 12 hr

/** Process delay types for downtime (per shift/line). Downtime = equipment/process only; use these to separate no production (manpower or shift not scheduled). */
var DEFAULT_PROCESS_DELAY_TYPES = ['Unburying Coils', 'live loading', 'training', 'CI project', 'unloading line', 'No production — Manpower', 'No production — Shift not scheduled'];

var DEFAULT_EQUIPMENT_LIST = [
  { id: 'E01', processArea: 'Uncoiler', name: 'Uncoiler Mandrel', criticality: 'High' },
  { id: 'E02', processArea: 'Uncoiler', name: 'Peeler / Snubber', criticality: 'Medium' },
  { id: 'E03', processArea: 'Entry', name: 'Entry Pinch Rolls', criticality: 'High' },
  { id: 'E04', processArea: 'Entry', name: 'Threading Table', criticality: 'Low' },
  { id: 'E05', processArea: 'Leveler', name: 'Leveler / Straightener', criticality: 'High' },
  { id: 'E06', processArea: 'Leveler', name: 'Back-up Rolls', criticality: 'Medium' },
  { id: 'E07', processArea: 'Leveler', name: 'Entry/Exit Guides', criticality: 'High' },
  { id: 'E08', processArea: 'Controls', name: 'Line PLC / HMI', criticality: 'High' },
  { id: 'E09', processArea: 'Controls', name: 'Drives / VFDs', criticality: 'High' },
  { id: 'E10', processArea: 'Lube', name: 'Oiler / Lube System', criticality: 'Medium' },
  { id: 'E11', processArea: 'Shear', name: 'Flying Shear / Cut-to-Length', criticality: 'High' },
  { id: 'E12', processArea: 'Shear', name: 'Shear Blades', criticality: 'High' },
  { id: 'E13', processArea: 'Measuring', name: 'Encoder / Length Measure', criticality: 'High' },
  { id: 'E14', processArea: 'Conveyor', name: 'Runout Conveyor', criticality: 'Medium' },
  { id: 'E15', processArea: 'Stacker', name: 'Crane', criticality: 'High' },
  { id: 'E16', processArea: 'Stacker', name: 'Stacker Conveyor / Rolls', criticality: 'Medium' },
  { id: 'E17', processArea: 'Hydraulics', name: 'Hydraulic Power Unit', criticality: 'High' },
  { id: 'E18', processArea: 'Safety', name: 'Light Curtains / E-Stops', criticality: 'High' },
  { id: 'E19', processArea: 'Electrical', name: 'Main Panel / MCC', criticality: 'High' },
  { id: 'E20', processArea: 'Air', name: 'Air Compressor', criticality: 'Medium' },
];

var DEFAULT_ISSUE_TYPES = ['Mechanical', 'Controls', 'Electrical', 'Hydraulics', 'Material setup'];

var CREW_IDS = ['A', 'B', 'C', 'D'];

const CTL_REPORT = {
  reportDate: '2026-03-02',
  reportLabel: 'Daily production',
  lines: [
    {
      name: '½ line',
      shifts: [
        { shift: '1st', crewId: 'A', coils: 12, downtime: [{ durationText: '1 ½ hours', durationMinutes: 90, reason: 'Unplanned maintenance (Peeler table leaking oil; West cone not spinning)' }], crew: 6, shiftHours: 12 },
        { shift: '2nd', crewId: 'B', coils: 8, downtime: [{ durationText: '1 ½ hours', durationMinutes: 90, reason: 'Unplanned maintenance (Cones not spinning)' }], crew: 6, shiftHours: 12 },
      ],
      lineTotal: 20,
    },
    {
      name: 'Redbud',
      shifts: [
        { shift: '1st', crewId: 'C', coils: 13, downtime: [{ durationText: '25 minutes', durationMinutes: 25, reason: 'QC check' }, { durationText: '1 hour', durationMinutes: 60, reason: 'Table getting full' }], crew: 5, shiftHours: 12 },
        { shift: '2nd', crewId: 'D', coils: 8, downtime: [], notes: 'Lost our main operator', crew: 6, shiftHours: 12 },
      ],
      lineTotal: 21,
    },
  ],
  grandTotal: 41,
};
