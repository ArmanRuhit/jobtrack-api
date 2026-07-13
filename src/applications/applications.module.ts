import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

@Module({
  // CompaniesModule exports CompaniesService; without this import, Nest cannot
  // resolve it here — provider visibility is explicit, unlike Spring's classpath scan.
  imports: [CompaniesModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
