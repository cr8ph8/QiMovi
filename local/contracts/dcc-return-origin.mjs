// This origin links a candidate image to an owned DCC return. It is not a
// camera-reopening receipt, licence, source admission or creative approval.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { code, status: 422 }); };
export function validateDccReturnOriginRef(ref) {
  need(object(ref) && Object.keys(ref).sort().join(',') === 'frameId,kitFilesSha256,receiptSha256', 'DCC_RETURN_ORIGIN_INVALID');
  need([ref.receiptSha256, ref.kitFilesSha256].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)), 'DCC_RETURN_ORIGIN_INVALID');
  need(typeof ref.frameId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(ref.frameId), 'DCC_RETURN_ORIGIN_INVALID');
  return ref;
}
