import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FileScanner, NoopFileScanner } from './file-scanner';
import { FilesService } from './files.service';

@Module({
  controllers: [FilesController],
  providers: [FilesService, { provide: FileScanner, useClass: NoopFileScanner }],
  exports: [FilesService],
})
export class FilesModule {}
