// -----------------------------------------------------------------------------
// Scene triggers and actions (manifest `scene_triggers`, `scene_actions`).
//
// Triggers: one event per transition, never a snapshot, never fired by a
// scene action or a command.
//
//   error_reported   an eBUS device reports an error code it did not report
//                    before (the boiler's "Currenterror", a controller's
//                    error message…), on a device the user created
//   error_cleared    …and no longer reports it
//   ebusd_offline    ebusd does not answer for 3 minutes
//   ebusd_online     it answers again (after an offline event only)
//
// Actions:
//
//   read_value       read any message of ebusd (by circuit and name), fresh
//                    from the bus when the cached value is too old
//   write_value      write a message open to everyone (never "install" or
//                    "service"), when the user allowed changes
// -----------------------------------------------------------------------------

export const SCENE_TRIGGERS = {
  ERROR_REPORTED: 'error_reported',
  ERROR_CLEARED: 'error_cleared',
  EBUSD_OFFLINE: 'ebusd_offline',
  EBUSD_ONLINE: 'ebusd_online',
};

// The data keys of each event, as declared in the manifest (fields and variables).
export const SCENE_TRIGGER_DATA = {
  [SCENE_TRIGGERS.ERROR_REPORTED]: ['device', 'device_name', 'circuit', 'message', 'error_code'],
  [SCENE_TRIGGERS.ERROR_CLEARED]: ['device', 'device_name', 'circuit', 'message', 'error_code'],
  [SCENE_TRIGGERS.EBUSD_OFFLINE]: ['address'],
  [SCENE_TRIGGERS.EBUSD_ONLINE]: ['address'],
};

export const SCENE_ACTIONS = { READ_VALUE: 'read_value', WRITE_VALUE: 'write_value' };

// The outputs each action returns, as declared in the manifest.
export const SCENE_ACTION_OUTPUTS = {
  [SCENE_ACTIONS.READ_VALUE]: ['value', 'number', 'unit', 'fields'],
  [SCENE_ACTIONS.WRITE_VALUE]: ['result'],
};
