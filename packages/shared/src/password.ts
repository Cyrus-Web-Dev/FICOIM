/** Kata sandi backup: batas keras di library = 8 karakter; UI sebaiknya mengarahkan ke "kuat" (>= 10 + variasi). */
export const MIN_BACKUP_PASSWORD_LENGTH = 8;

const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123',
  'qwertyuiop', 'iloveyou', 'admin123', 'abc12345', 'indonesia', 'indonesia123', 'rahasia123',
  'katasandi', 'katasandi123', 'bismillah', 'bismillah123', 'ficoim123', 'inventaris',
]);

/** NFKC supaya karakter yang sama dari keyboard HP vs PC menghasilkan kunci yang sama. */
export function normalizePassword(password: string): string {
  return password.normalize('NFKC');
}

export interface PasswordCheck {
  ok: boolean; // memenuhi syarat "kuat" untuk backup
  score: 0 | 1 | 2 | 3 | 4;
  issues: string[];
}

export function checkBackupPassword(password: string): PasswordCheck {
  const pw = normalizePassword(password);
  const issues: string[] = [];
  let hard = false;
  if (pw.length < MIN_BACKUP_PASSWORD_LENGTH) {
    issues.push(`Minimal ${MIN_BACKUP_PASSWORD_LENGTH} karakter.`);
    hard = true;
  } else if (pw.length < 10) {
    issues.push('Disarankan minimal 10 karakter.');
  }
  if (COMMON.has(pw.toLowerCase())) { issues.push('Kata sandi ini terlalu umum.'); hard = true; }
  if (/^(.)\1+$/.test(pw)) { issues.push('Jangan memakai satu karakter yang diulang.'); hard = true; }
  if (/^\d+$/.test(pw)) { issues.push('Jangan hanya angka; tambahkan huruf.'); hard = true; }
  const classes =
    Number(/[a-z]/.test(pw)) + Number(/[A-Z]/.test(pw)) + Number(/\d/.test(pw)) + Number(/[^A-Za-z0-9]/.test(pw));
  if (classes < 2) { issues.push('Gabungkan huruf besar/kecil, angka, atau simbol.'); hard = true; }

  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (classes >= 3) score++;
  if (pw.length >= 16 || (pw.length >= 12 && classes === 4)) score++;
  if (hard) score = Math.min(score, 1);
  return { ok: !hard && pw.length >= 10, score: score as PasswordCheck['score'], issues };
}
