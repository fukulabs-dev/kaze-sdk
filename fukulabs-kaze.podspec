require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "fukulabs-kaze"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://fukulabs.dev"
  s.license      = package["license"] || "MIT"
  s.authors      = { "fukulabs" => "hello@fukulabs.dev" }
  s.platforms    = { :ios => "13.4" }
  s.source       = { :git => "https://github.com/fukulabs/kaze-react-native.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  
  s.dependency "React-Core"
  s.swift_version = "5.0"
end
