import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../src/platform/errors.js';

describe('error taxonomy', () => {
  it('maps each error to its status code and stable code', () => {
    expect(new NotFoundError()).toMatchObject({ statusCode: 404, code: 'not_found' });
    expect(new ValidationError()).toMatchObject({ statusCode: 422, code: 'validation_error' });
    expect(new ConflictError()).toMatchObject({ statusCode: 409, code: 'conflict' });
  });

  it('keeps details for the response envelope', () => {
    const err = new ConflictError('already published', { articleId: 'abc' });
    expect(err.details).toEqual({ articleId: 'abc' });
  });

  it('is catchable as AppError', () => {
    expect(new NotFoundError()).toBeInstanceOf(AppError);
  });
});
