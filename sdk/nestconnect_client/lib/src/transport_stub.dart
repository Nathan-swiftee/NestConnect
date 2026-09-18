import 'transport.dart';

/// Neither `dart:io` nor a browser — which today means nothing real, and is
/// here so the conditional import in `transport.dart` has a default that says
/// what is wrong rather than failing to resolve.
NestTransport createTransport(String baseUrl) => throw UnsupportedError(
      'nestconnect_client needs either dart:io or a browser. '
      'If you are seeing this on a real platform, it is a bug — please report it.',
    );
