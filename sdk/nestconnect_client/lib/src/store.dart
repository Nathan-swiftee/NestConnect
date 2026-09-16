/// Where the session token is kept between launches.
///
/// An interface rather than a choice, because the right answer depends on the
/// host: a Flutter app wants secure storage or shared preferences, a test wants
/// memory, and a package that reached for any of those would drag a dependency
/// — and a plugin — into every app that uses it.
abstract class NestTokenStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

/// Forgets everything when the app closes. The default, and honest about it:
/// a customer who reopens the app gets their history back from the server by
/// signing in again, and an anonymous one starts fresh rather than silently
/// losing a thread they could not have found anyway.
class NestMemoryTokenStore implements NestTokenStore {
  final _values = <String, String>{};

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> write(String key, String value) async => _values[key] = value;

  @override
  Future<void> delete(String key) async => _values.remove(key);
}
