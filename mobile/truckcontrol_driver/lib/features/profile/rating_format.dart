// Formatting for the E-7 rating card.
//
// The server sends hundredths and basis points — integers — precisely so that
// no floating point sits between the calculation and the driver. These two
// functions are the only place those integers become text, which is why they
// live outside the widget and are tested.

/// 437 → "4.37"; null (not enough trips yet) → "—".
String formatRating(int? centis) {
  if (centis == null) return '—';
  final whole = centis ~/ 100;
  final fraction = (centis % 100).toString().padLeft(2, '0');
  return '$whole.$fraction';
}

/// Basis points → a signed percentage with one decimal: 420 → "+4.2%".
/// The sign is kept because burning under the norm is worth seeing too.
String formatDeviation(int? bp) {
  if (bp == null) return '—';
  final sign = bp > 0 ? '+' : '';
  final tenths = (bp.abs() % 100 * 10 + 50) ~/ 100;
  final rounded = tenths == 10 ? '${bp.abs() ~/ 100 + 1}.0' : '${bp.abs() ~/ 100}.$tenths';
  return '$sign${bp < 0 ? '-' : ''}$rounded%';
}
