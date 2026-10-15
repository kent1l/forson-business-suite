'use strict';

const {
  cents,
  money,
  fail
} = require('../cashDrawerService');
function share(monthly, schedule, sequence) {
  if (![1, 2].includes(Number(sequence))) fail(400, 'INVALID_CUTOFF', 'Cutoff sequence must be 1 or 2.');
  const amount = cents(monthly, {
    positive: true
  });
  if (schedule === 'FIRST_CUTOFF') return money(Number(sequence) === 1 ? amount : 0n);
  if (schedule === 'SECOND_CUTOFF') return money(Number(sequence) === 2 ? amount : 0n);
  if (schedule === 'SPLIT_HALF') {
    const first = (amount + 1n) / 2n;
    return money(Number(sequence) === 1 ? first : amount - first);
  }
  fail(400, 'INVALID_SCHEDULE', 'Choose first cutoff, second cutoff, or split monthly.');
}
const preview = (monthly, schedule) => ({
  first_cutoff: share(monthly, schedule, 1),
  second_cutoff: share(monthly, schedule, 2)
});
module.exports = {
  share,
  preview
};
