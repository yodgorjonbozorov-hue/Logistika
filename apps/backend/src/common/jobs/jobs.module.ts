import { Global, Module } from '@nestjs/common';
import { JobsService } from './jobs.service';

/**
 * Global because producers live all over the app (auth sends SMS, files
 * compress, tracking archives) and none of them should have to import a queue
 * module to hand off a piece of work.
 */
@Global()
@Module({
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
