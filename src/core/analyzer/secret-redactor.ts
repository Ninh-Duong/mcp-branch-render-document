export class SecretRedactor {
  private static readonly SECRET_REGEXES: RegExp[] = [
    /Bearer\s+[A-Za-z0-9\-_.]+/gi,
    /ghp_[A-Za-z0-9_]{36}/g,
    /github_pat_[A-Za-z0-9_]{82}/g,
    /AKIA[0-9A-Z]{16}/g,
    /(?:api_key|apikey|secret|password|passwd|token)\s*[:=]\s*['"][A-Za-z0-9\-_.~+/=]{8,}['"]/gi,
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  ];

  public static redactString(input: string): string {
    let result = input;
    for (const regex of SecretRedactor.SECRET_REGEXES) {
      result = result.replace(regex, '[SECRET_REDACTED]');
    }
    return result;
  }

  public static isSecretFile(filePath: string, secretPatterns: string[] = []): boolean {
    const patterns = [
      '.env',
      '.pem',
      '.key',
      'id_rsa',
      'credentials',
      'secrets',
      ...secretPatterns.map((p) => p.replace(/^\*\*\//, '').replace(/\*$/, '')),
    ];

    return patterns.some((p) => filePath.toLowerCase().includes(p.toLowerCase()));
  }
}
