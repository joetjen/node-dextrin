namespace Test;

/** A user of the shop. */
@summary("User")
model User {
  @key id: string;
  @minLength(1) @maxLength(40) name: string;
  @minValue(0) @maxValueExclusive(150) age: int32;
  @minValue(utcDateTime.fromISO("2000-01-01T00:00:00Z")) since: utcDateTime;
  @pattern("^[a-z]+$", "lower case only") handle: string;
  @format("uuid") ref: string;
  @format("postal-code") zip: string;
  @secret password: string;
  @visibility(Lifecycle.Read) created: utcDateTime;
  @visibility(Lifecycle.Create, Lifecycle.Update) secretAnswer: string;
  #deprecated "use name"
  legacy?: string;
  @example("x") nick?: string;
}
