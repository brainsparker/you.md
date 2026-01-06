/**
 * Base error class for you.md errors
 */
export class YouMdError extends Error {
  readonly code: string;
  readonly line?: number;
  readonly column?: number;

  constructor(
    code: string,
    message: string,
    options?: { line?: number; column?: number; cause?: Error }
  ) {
    super(message, { cause: options?.cause });
    this.name = "YouMdError";
    this.code = code;
    this.line = options?.line;
    this.column = options?.column;
  }
}

/**
 * Error thrown when file operations fail
 */
export class YouMdFileError extends YouMdError {
  readonly path: string;

  constructor(
    code: string,
    message: string,
    path: string,
    options?: { cause?: Error }
  ) {
    super(code, message, options);
    this.name = "YouMdFileError";
    this.path = path;
  }
}

/**
 * Error thrown when file exceeds size limit
 */
export class YouMdSizeError extends YouMdError {
  readonly size: number;
  readonly maxSize: number;

  constructor(size: number, maxSize: number) {
    super(
      "FILE_TOO_LARGE",
      `File size ${size} bytes exceeds maximum ${maxSize} bytes`
    );
    this.name = "YouMdSizeError";
    this.size = size;
    this.maxSize = maxSize;
  }
}

/**
 * Error thrown when parsing fails
 */
export class YouMdParseError extends YouMdError {
  constructor(
    code: string,
    message: string,
    options?: { line?: number; column?: number; cause?: Error }
  ) {
    super(code, message, options);
    this.name = "YouMdParseError";
  }
}

/**
 * Error thrown when YAML parsing fails
 */
export class YouMdYamlError extends YouMdParseError {
  constructor(
    message: string,
    options?: { line?: number; column?: number; cause?: Error }
  ) {
    super("INVALID_YAML", message, options);
    this.name = "YouMdYamlError";
  }
}

/**
 * Error thrown when network operations fail
 */
export class YouMdNetworkError extends YouMdError {
  readonly url: string;
  readonly statusCode?: number;

  constructor(
    message: string,
    url: string,
    options?: { statusCode?: number; cause?: Error }
  ) {
    super("NETWORK_ERROR", message, { cause: options?.cause });
    this.name = "YouMdNetworkError";
    this.url = url;
    this.statusCode = options?.statusCode;
  }
}

/**
 * Error thrown when operation times out
 */
export class YouMdTimeoutError extends YouMdError {
  readonly timeout: number;

  constructor(operation: string, timeout: number) {
    super("TIMEOUT", `${operation} timed out after ${timeout}ms`);
    this.name = "YouMdTimeoutError";
    this.timeout = timeout;
  }
}

/**
 * Error thrown when validation fails
 */
export class YouMdValidationError extends YouMdError {
  constructor(
    code: string,
    message: string,
    options?: { line?: number; column?: number }
  ) {
    super(code, message, options);
    this.name = "YouMdValidationError";
  }
}
