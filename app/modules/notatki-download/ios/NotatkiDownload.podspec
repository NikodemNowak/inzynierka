Pod::Spec.new do |s|
  s.name = 'NotatkiDownload'
  s.version = '1.0.0'
  s.summary = 'Durable authorized background model downloads'
  s.description = 'Background URLSession downloads with native integrity verification.'
  s.license = { :type => 'MIT' }
  s.author = 'Nikodem Nowak'
  s.homepage = 'https://github.com/NikodemNowak/inzynierka'
  s.platform = :ios, '17.0'
  s.swift_version = '5.9'
  s.source = { :git => 'https://github.com/NikodemNowak/inzynierka.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'ExpoFileSystem'
  s.frameworks = 'UserNotifications', 'CryptoKit'
  s.source_files = '*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
