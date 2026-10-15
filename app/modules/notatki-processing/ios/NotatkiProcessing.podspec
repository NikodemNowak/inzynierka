Pod::Spec.new do |s|
  s.name = 'NotatkiProcessing'
  s.version = '1.0.0'
  s.summary = 'User initiated processing lifecycle for Notatki'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Nikodem Nowak'
  s.homepage = 'https://github.com/NikodemNowak/inzynierka'
  s.platforms = { :ios => '17.0' }
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.swift_version = '5.9'
  s.source_files = '**/*.{h,m,mm,swift}'
end
