const MANILA_TZ = 'Asia/Manila';
const manilaDateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * YYYY-MM-DD for the given instant, read off the Manila calendar rather than
 * the server process's local zone. Used to key session validity to a Manila
 * calendar day (e.g. forcing logout the next day) instead of a rolling
 * duration, independent of where the API happens to be hosted.
 */
function manilaDateString(date = new Date()) {
    return manilaDateFormatter.format(date);
}

module.exports = { manilaDateString };
