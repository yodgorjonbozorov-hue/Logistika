import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import { I18nService } from '../../i18n/i18n.service';
import { AppException } from '../exceptions/app.exception';
import { AppExceptionFilter } from './app-exception.filter';

function createHost(acceptLanguage?: string) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({
        headers: { 'accept-language': acceptLanguage },
        method: 'GET',
        url: '/api/v1/test',
      }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AppExceptionFilter', () => {
  const filter = new AppExceptionFilter(new I18nService());

  it('converts AppException to the standard envelope with i18n message', () => {
    const { host, status, json } = createHost('ru');
    filter.catch(new AppException('AUTH_INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(json).toHaveBeenCalledWith({
      success: false,
      data: null,
      error: {
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Неверный логин или пароль',
        details: undefined,
      },
      meta: null,
    });
  });

  it('defaults to uz-latn when no Accept-Language is sent', () => {
    const { host, json } = createHost(undefined);
    filter.catch(new AppException('NOT_FOUND', HttpStatus.NOT_FOUND), host);
    expect(json.mock.calls[0]![0].error.message).toBe("Ma'lumot topilmadi");
  });

  it('maps ValidationPipe errors to VALIDATION_FAILED with field details', () => {
    const { host, status, json } = createHost();
    filter.catch(new BadRequestException(['identifier should not be empty']), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    const body = json.mock.calls[0]![0];
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual(['identifier should not be empty']);
  });

  it('hides unknown errors behind a generic 500 INTERNAL_ERROR', () => {
    const { host, status, json } = createHost();
    filter.catch(new Error('db exploded: password=secret'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = json.mock.calls[0]![0];
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('db exploded');
  });
});
