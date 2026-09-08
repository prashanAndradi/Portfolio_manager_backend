const db = require('../config/db');

const DealerLimit = {
  getAll: async () => {
    const sql = `
      SELECT dl.*,
        u.username,
        pu.username AS proposed_by_username,
        au.username AS approved_by_username,
        ru.username AS rejected_by_username
      FROM dealer_limits dl
      LEFT JOIN users u ON u.id = dl.user_id
      LEFT JOIN users pu ON pu.id = dl.proposed_by
      LEFT JOIN users au ON au.id = dl.approved_by
      LEFT JOIN users ru ON ru.id = dl.rejected_by
      ORDER BY u.username
    `;
    const [rows] = await db.query(sql);
    return rows;
  },

  // Rows with a pending proposal awaiting officer/manager review.
  getPendingApprovals: async () => {
    const sql = `
      SELECT dl.*, u.username, pu.username AS proposed_by_username
      FROM dealer_limits dl
      LEFT JOIN users u ON u.id = dl.user_id
      LEFT JOIN users pu ON pu.id = dl.proposed_by
      WHERE dl.pending_per_deal_limit IS NOT NULL OR dl.pending_per_day_limit IS NOT NULL
      ORDER BY dl.proposed_at ASC
    `;
    const [rows] = await db.query(sql);
    return rows;
  },

  getById: async (id) => {
    const [rows] = await db.query('SELECT * FROM dealer_limits WHERE id = ?', [id]);
    return rows[0] || null;
  },

  getByUser: async (userId, currency = 'LKR') => {
    const [rows] = await db.query(
      'SELECT * FROM dealer_limits WHERE user_id = ? AND currency = ?',
      [userId, currency]
    );
    return rows[0] || null;
  },

  // Direct write to the ACTIVE (enforced) limit - used by officer/manager's
  // own edits, which take effect immediately (no approval needed for the
  // tier that would be approving anyway). Also clears any pending proposal
  // on the row, since it would otherwise sit stale next to freshly-changed
  // active values.
  createOrUpdate: async ({ user_id, per_deal_limit, per_day_limit, currency }) => {
    const cur = currency || 'LKR';
    const [existing] = await db.query(
      'SELECT id FROM dealer_limits WHERE user_id = ? AND currency = ?',
      [user_id, cur]
    );
    if (existing.length > 0) {
      await db.query(
        `UPDATE dealer_limits
         SET per_deal_limit = ?, per_day_limit = ?,
             pending_per_deal_limit = NULL, pending_per_day_limit = NULL,
             proposed_by = NULL, proposed_at = NULL
         WHERE user_id = ? AND currency = ?`,
        [per_deal_limit || 0, per_day_limit || 0, user_id, cur]
      );
    } else {
      await db.query(
        'INSERT INTO dealer_limits (user_id, per_deal_limit, per_day_limit, currency) VALUES (?, ?, ?, ?)',
        [user_id, per_deal_limit || 0, per_day_limit || 0, cur]
      );
    }
    const [rows] = await db.query(
      'SELECT * FROM dealer_limits WHERE user_id = ? AND currency = ?',
      [user_id, cur]
    );
    return rows[0];
  },

  // Stage a change proposed by a middle_office_user - does NOT touch the
  // active columns, so enforcement (dealerLimitCheckService) keeps using the
  // last-approved values until an officer/manager approves this proposal.
  proposeChange: async ({ user_id, per_deal_limit, per_day_limit, currency, proposed_by }) => {
    const cur = currency || 'LKR';
    const [existing] = await db.query(
      'SELECT id FROM dealer_limits WHERE user_id = ? AND currency = ?',
      [user_id, cur]
    );
    if (existing.length > 0) {
      await db.query(
        `UPDATE dealer_limits
         SET pending_per_deal_limit = ?, pending_per_day_limit = ?,
             proposed_by = ?, proposed_at = NOW(),
             rejected_by = NULL, rejected_at = NULL, rejection_reason = NULL
         WHERE user_id = ? AND currency = ?`,
        [per_deal_limit || 0, per_day_limit || 0, proposed_by, user_id, cur]
      );
    } else {
      // Brand new row: no active limit yet (0 = "not configured", matching
      // the existing "no row = allowed" convention in the check service)
      // until this first proposal is approved.
      await db.query(
        `INSERT INTO dealer_limits
           (user_id, per_deal_limit, per_day_limit, currency,
            pending_per_deal_limit, pending_per_day_limit, proposed_by, proposed_at)
         VALUES (?, 0, 0, ?, ?, ?, ?, NOW())`,
        [user_id, cur, per_deal_limit || 0, per_day_limit || 0, proposed_by]
      );
    }
    const [rows] = await db.query(
      'SELECT * FROM dealer_limits WHERE user_id = ? AND currency = ?',
      [user_id, cur]
    );
    return rows[0];
  },

  approveChange: async (id, approved_by) => {
    const [result] = await db.query(
      `UPDATE dealer_limits
       SET per_deal_limit = COALESCE(pending_per_deal_limit, per_deal_limit),
           per_day_limit = COALESCE(pending_per_day_limit, per_day_limit),
           pending_per_deal_limit = NULL, pending_per_day_limit = NULL,
           approved_by = ?, approved_at = NOW(),
           rejected_by = NULL, rejected_at = NULL, rejection_reason = NULL
       WHERE id = ? AND (pending_per_deal_limit IS NOT NULL OR pending_per_day_limit IS NOT NULL)`,
      [approved_by, id]
    );
    return result;
  },

  rejectChange: async (id, rejected_by, reason) => {
    const [result] = await db.query(
      `UPDATE dealer_limits
       SET pending_per_deal_limit = NULL, pending_per_day_limit = NULL,
           rejected_by = ?, rejected_at = NOW(), rejection_reason = ?
       WHERE id = ? AND (pending_per_deal_limit IS NOT NULL OR pending_per_day_limit IS NOT NULL)`,
      [rejected_by, reason || null, id]
    );
    return result;
  },

  delete: async (id) => {
    const [result] = await db.query('DELETE FROM dealer_limits WHERE id = ?', [id]);
    return result;
  }
};

module.exports = DealerLimit;
