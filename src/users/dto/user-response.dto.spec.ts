import { UserResponseDto } from './user-response.dto';
import { CURRENT_TERMS_VERSION } from '../../auth/terms-version';
import type { User } from '../entities/user.entity';

describe('UserResponseDto.requires_terms_acceptance', () => {
  const base = {
    id: 'u',
    username: 'n',
    email: 'e',
    is_active: true,
    is_admin: false,
  };

  it('is true for legacy accounts that never accepted', () => {
    expect(
      UserResponseDto.fromEntity(base as User).requires_terms_acceptance,
    ).toBe(true);
  });

  it('is false once the current version was accepted', () => {
    const user = {
      ...base,
      terms_accepted_at: new Date(),
      terms_version: CURRENT_TERMS_VERSION,
    };
    expect(
      UserResponseDto.fromEntity(user as User).requires_terms_acceptance,
    ).toBe(false);
  });

  it('is true again when the published version moves on', () => {
    const user = {
      ...base,
      terms_accepted_at: new Date(),
      terms_version: 'older',
    };
    expect(
      UserResponseDto.fromEntity(user as User).requires_terms_acceptance,
    ).toBe(true);
  });
});
